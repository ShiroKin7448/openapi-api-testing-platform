import prisma from '../utils/prisma';
import { WorkspaceRole as PrismaWorkspaceRole, MemberStatus as PrismaMemberStatus } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { Workspace, WorkspaceMember, WorkspaceRole, MemberStatus } from '@shared/types';

// ─── Role ordering for privilege escalation guard ────────────────────────────
const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  [WorkspaceRole.OWNER]: 5,
  [WorkspaceRole.ADMIN]: 4,
  [WorkspaceRole.TESTER]: 3,
  [WorkspaceRole.DEVELOPER]: 2,
  [WorkspaceRole.VIEWER]: 1,
};

/** All roles that can view workspace resources */
export const ALL_MEMBER_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.TESTER,
  WorkspaceRole.DEVELOPER,
  WorkspaceRole.VIEWER,
];

export class WorkspaceService {
  async listForUser(userId: string) {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    return memberships.map((m) => ({ ...m.workspace, role: m.role, status: m.status }));
  }

  async getForUser(userId: string, workspaceId: string): Promise<Workspace> {
    await this.requireRole(userId, workspaceId, ALL_MEMBER_ROLES);
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new AppError('Workspace not found', 404);
    return workspace as unknown as Workspace;
  }

  async updateWorkspace(userId: string, workspaceId: string, name: string): Promise<Workspace> {
    await this.requireRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
    return workspace as unknown as Workspace;
  }

  async deleteWorkspace(userId: string, workspaceId: string): Promise<void> {
    await this.requireRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }

  /**
   * Create a new workspace and assign the creator as OWNER
   */
  async createWorkspace(userId: string, name: string): Promise<Workspace> {
    const workspace = await prisma.$transaction(async (tx) => {
      const newWorkspace = await tx.workspace.create({ data: { name } });
      await tx.workspaceMember.create({
        data: {
          userId,
          workspaceId: newWorkspace.id,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
      return newWorkspace;
    });
    return workspace as unknown as Workspace;
  }

  /**
   * Invite a member by email. OWNER and ADMIN can invite.
   * ADMIN cannot invite OWNER.
   */
  async inviteMemberByEmail(
    requesterId: string,
    workspaceId: string,
    email: string,
    role: WorkspaceRole
  ): Promise<WorkspaceMember> {
    const requester = await this.requireRole(requesterId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    // Privilege escalation guard: requester cannot assign a role >= their own (except OWNER can do anything)
    const requesterRole = requester.role as WorkspaceRole;
    if (
      requesterRole !== WorkspaceRole.OWNER &&
      ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requesterRole]
    ) {
      throw new AppError('You cannot assign a role equal to or higher than your own', 403);
    }

    // ADMIN cannot invite OWNER
    if (requesterRole === WorkspaceRole.ADMIN && role === WorkspaceRole.OWNER) {
      throw new AppError('Administrators cannot invite members with Owner role', 403);
    }

    // Find the user by email
    const targetUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!targetUser) {
      // User not found — create a pending-invite placeholder
      // For now we store the invitation with a sentinel user approach: record
      // with invitedEmail but no userId. The schema requires userId, so we
      // only support existing-user invites in phase 26.
      throw new AppError(
        'User not found. Only registered users can be invited in this version.',
        404,
        true,
        'USER_NOT_FOUND'
      );
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUser.id, workspaceId } },
    });
    if (existing) {
      throw new AppError('User is already a member of this workspace', 400);
    }

    const member = await prisma.workspaceMember.create({
      data: {
        userId: targetUser.id,
        workspaceId,
        role: role as PrismaWorkspaceRole,
        status: 'ACTIVE' as PrismaMemberStatus,
        invitedEmail: email,
        invitedAt: new Date(),
        joinedAt: new Date(),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return member as unknown as WorkspaceMember;
  }

  /**
   * Add a new member to the workspace by userId. OWNER and ADMIN can do this.
   */
  async addMember(
    requesterId: string,
    workspaceId: string,
    targetUserId: string,
    role: WorkspaceRole
  ): Promise<WorkspaceMember> {
    const requester = await this.requireRole(requesterId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    const requesterRole = requester.role as WorkspaceRole;

    // ADMIN cannot add OWNER
    if (requesterRole === WorkspaceRole.ADMIN && role === WorkspaceRole.OWNER) {
      throw new AppError('Administrators cannot add members with Owner role', 403);
    }

    // Privilege escalation: non-OWNER cannot assign role >= their own
    if (
      requesterRole !== WorkspaceRole.OWNER &&
      ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requesterRole]
    ) {
      throw new AppError('You cannot assign a role equal to or higher than your own', 403);
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
    if (existing) {
      throw new AppError('User is already a member of this workspace', 400);
    }

    const member = await prisma.workspaceMember.create({
      data: {
        userId: targetUserId,
        workspaceId,
        role: role as PrismaWorkspaceRole,
        status: 'ACTIVE' as PrismaMemberStatus,
        joinedAt: new Date(),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return member as unknown as WorkspaceMember;
  }

  /**
   * Update a member's role. OWNER can change anyone. ADMIN can change roles
   * below their own (not OWNER or ADMIN). Cannot demote the last OWNER.
   */
  async updateMemberRole(
    requesterId: string,
    workspaceId: string,
    memberId: string,
    newRole: WorkspaceRole
  ): Promise<WorkspaceMember> {
    const requester = await this.requireRole(requesterId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    const requesterRole = requester.role as WorkspaceRole;

    // Find the target member
    const target = await prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!target) throw new AppError('Member not found', 404);

    const targetCurrentRole = target.role as WorkspaceRole;

    // Cannot modify an OWNER if requester is not OWNER
    if (targetCurrentRole === WorkspaceRole.OWNER && requesterRole !== WorkspaceRole.OWNER) {
      throw new AppError('Only Owners can modify the role of another Owner', 403);
    }

    // Privilege escalation: cannot assign a role >= own (unless OWNER)
    if (
      requesterRole !== WorkspaceRole.OWNER &&
      ROLE_HIERARCHY[newRole] >= ROLE_HIERARCHY[requesterRole]
    ) {
      throw new AppError('You cannot assign a role equal to or higher than your own', 403);
    }

    // Last-OWNER guard: cannot demote the last OWNER
    if (targetCurrentRole === WorkspaceRole.OWNER && newRole !== WorkspaceRole.OWNER) {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new AppError(
          'Cannot demote the last Owner of the workspace. Assign another Owner first.',
          400
        );
      }
    }

    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: newRole as PrismaWorkspaceRole },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return updated as unknown as WorkspaceMember;
  }

  /**
   * Remove a member. OWNER can remove anyone except themselves (if last OWNER).
   * ADMIN can remove members with lower roles.
   */
  async removeMember(requesterId: string, workspaceId: string, memberId: string): Promise<void> {
    const requester = await this.requireRole(requesterId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    const requesterRole = requester.role as WorkspaceRole;

    const target = await prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!target) throw new AppError('Member not found', 404);

    const targetRole = target.role as WorkspaceRole;

    // Cannot remove an OWNER if requester is not OWNER
    if (targetRole === WorkspaceRole.OWNER && requesterRole !== WorkspaceRole.OWNER) {
      throw new AppError('Only Owners can remove another Owner', 403);
    }

    // Last-OWNER guard
    if (targetRole === WorkspaceRole.OWNER && target.userId === requesterId) {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new AppError(
          'Cannot remove the last Owner. Transfer ownership or delete the workspace.',
          400
        );
      }
    }

    // ADMIN cannot remove members with same or higher rank
    console.log('DEBUG_REMOVE:', { requesterRole, targetRole, adminRank: ROLE_HIERARCHY[WorkspaceRole.ADMIN], targetRank: ROLE_HIERARCHY[targetRole] });
    if (
      requesterRole === WorkspaceRole.ADMIN &&
      ROLE_HIERARCHY[targetRole] >= ROLE_HIERARCHY[WorkspaceRole.ADMIN]
    ) {
      throw new AppError('Administrators cannot remove members with Admin or Owner role', 403);
    }

    await prisma.workspaceMember.delete({ where: { id: memberId } });
  }

  /**
   * Ensure a user has one of the required roles in a workspace.
   * Returns the membership record.
   */
  async requireRole(
    userId: string,
    workspaceId: string,
    allowedRoles: WorkspaceRole[]
  ): Promise<WorkspaceMember> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    if (!member) {
      throw new AppError('You are not a member of this workspace', 403);
    }

    if (!allowedRoles.includes(member.role as WorkspaceRole)) {
      throw new AppError(
        `Insufficient permissions. Required one of: ${allowedRoles.join(', ')}`,
        403
      );
    }

    return member as unknown as WorkspaceMember;
  }

  /**
   * Get all members of a workspace (any role can read).
   */
  async getMembers(requesterId: string, workspaceId: string): Promise<WorkspaceMember[]> {
    await this.requireRole(requesterId, workspaceId, ALL_MEMBER_ROLES);

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return members as unknown as WorkspaceMember[];
  }
}
