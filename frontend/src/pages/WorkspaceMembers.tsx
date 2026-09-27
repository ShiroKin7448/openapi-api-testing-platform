import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Users, UserPlus, Shield, Trash2, ChevronDown, Crown, Eye, Code2, FlaskConical, ShieldCheck, AlertTriangle } from 'lucide-react';
import { workspacesApi } from '../api/workspaces.api';
import { queryKeys } from '../api/queryClient';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useAuthStore } from '../store/useAuthStore';
import { apiErrorMessage } from '../api/errors';
import type { WorkspaceMember } from '@shared/types';
import { WorkspaceRole } from '@shared/types';

// ─── Role Config ──────────────────────────────────────────────────────────────

const ROLE_ORDER: WorkspaceRole[] = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.TESTER, WorkspaceRole.DEVELOPER, WorkspaceRole.VIEWER];

const ROLE_META: Record<WorkspaceRole, { label: string; description: string; colorClass: string; icon: React.FC<{ className?: string }> }> = {
  [WorkspaceRole.OWNER]: {
    label: 'Owner',
    description: 'Full workspace control — manage members, projects, environments, settings',
    colorClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    icon: Crown,
  },
  [WorkspaceRole.ADMIN]: {
    label: 'Admin',
    description: 'Manage projects, environments, test cases, run tests, view analytics',
    colorClass: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
    icon: ShieldCheck,
  },
  [WorkspaceRole.TESTER]: {
    label: 'Tester',
    description: 'Generate/edit test cases, run tests, view assigned projects and reports',
    colorClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: FlaskConical,
  },
  [WorkspaceRole.DEVELOPER]: {
    label: 'Developer',
    description: 'View API specs & test cases, run assigned tests, view failed/regression results',
    colorClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
    icon: Code2,
  },
  [WorkspaceRole.VIEWER]: {
    label: 'Viewer',
    description: 'Read-only: view projects, endpoints, test cases, runs and analytics',
    colorClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    icon: Eye,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  OWNER: 5, ADMIN: 4, TESTER: 3, DEVELOPER: 2, VIEWER: 1,
};

/** Roles a requester is allowed to assign (non-OWNER cannot assign >= their own) */
function assignableRoles(myRole: WorkspaceRole): WorkspaceRole[] {
  if (myRole === 'OWNER') return ROLE_ORDER;
  return ROLE_ORDER.filter((r) => ROLE_HIERARCHY[r] < ROLE_HIERARCHY[myRole]);
}

function canManageMembers(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function canRemoveMember(myRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  if (myRole === 'OWNER') return true;
  if (myRole === 'ADMIN') return ROLE_HIERARCHY[targetRole] < ROLE_HIERARCHY['ADMIN'];
  return false;
}

function canEditRole(myRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  if (myRole === 'OWNER') return true;
  if (myRole === 'ADMIN') return ROLE_HIERARCHY[targetRole] < ROLE_HIERARCHY['ADMIN'];
  return false;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date as string));
  } catch {
    return String(date);
  }
}

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: WorkspaceRole }) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${meta.colorClass}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function RoleSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: WorkspaceRole;
  options: WorkspaceRole[];
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as WorkspaceRole)}
        disabled={disabled}
        className="appearance-none rounded-lg px-3 py-1.5 pr-7 text-xs font-medium bg-slate-50 dark:bg-dark-850 border border-slate-200 dark:border-white/[0.1] focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {options.map((r) => (
          <option key={r} value={r}>{ROLE_META[r].label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WorkspaceMembers() {
  const { workspaceId: paramWorkspaceId } = useParams<{ workspaceId: string }>();
  const storeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceId = paramWorkspaceId ?? storeWorkspaceId ?? '';
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>(WorkspaceRole.TESTER);
  const [inviteError, setInviteError] = useState('');
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<WorkspaceRole>(WorkspaceRole.TESTER);

  // ── Queries ──────────────────────────────────────────────────────────────
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: workspacesApi.list });
  const myRole = (workspaces.data?.find((w) => w.id === workspaceId)?.role ?? WorkspaceRole.VIEWER) as WorkspaceRole;
  const workspace = workspaces.data?.find((w) => w.id === workspaceId);

  const membersQuery = useQuery({
    queryKey: queryKeys.members(workspaceId),
    queryFn: () => workspacesApi.members(workspaceId),
    enabled: Boolean(workspaceId),
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const inviteMutation = useMutation({
    mutationFn: () => workspacesApi.inviteByEmail(workspaceId, inviteEmail.trim(), inviteRole),
    onSuccess: () => {
      setInviteEmail('');
      setInviteError('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) });
    },
    onError: (err: unknown) => setInviteError(apiErrorMessage(err, 'Failed to invite member.')),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WorkspaceRole }) =>
      workspacesApi.updateMember(workspaceId, memberId, role),
    onSuccess: () => {
      setEditingMemberId(null);
      toast.success('Member role updated successfully');
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) });
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err, 'Failed to update role.')),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => workspacesApi.removeMember(workspaceId, memberId),
    onSuccess: () => {
      toast.success('Member removed successfully');
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) });
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err, 'Failed to remove member.')),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleInvite = (e: FormEvent) => {
    e.preventDefault();
    setInviteError('');
    inviteMutation.mutate();
  };

  const handleStartEdit = (member: WorkspaceMember) => {
    setEditingMemberId(member.id);
    setEditRole(member.role);
  };

  const handleSaveRole = (memberId: string) => {
    updateRoleMutation.mutate({ memberId, role: editRole });
  };

  const handleRemove = (member: WorkspaceMember) => {
    if (!confirm(`Remove ${member.user?.name ?? 'this member'} from the workspace?`)) return;
    removeMutation.mutate(member.id);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!workspaceId) {
    return (
      <div className="glass-panel p-8 text-center text-sm text-slate-500">
        Select a workspace to manage its members.
      </div>
    );
  }

  const members = membersQuery.data ?? [];
  const canManage = canManageMembers(myRole);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-500 flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Members — {workspace?.name ?? workspaceId}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Your role: <RoleBadge role={myRole} />
          </p>
        </div>
      </div>

      {/* Role legend */}
      <section className="glass-panel p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <Shield className="w-4 h-4" /> Role Permissions
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROLE_ORDER.map((role) => {
            const meta = ROLE_META[role];
            const Icon = meta.icon;
            return (
              <div key={role} className={`rounded-xl border px-3 py-2.5 ${role === myRole ? 'border-primary-400 dark:border-primary-500 ring-1 ring-primary-400' : 'border-slate-200 dark:border-white/[0.08]'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-bold">{meta.label}</span>
                  {role === myRole && <span className="ml-auto text-[10px] font-semibold text-primary-600 dark:text-primary-400">You</span>}
                </div>
                <p className="text-[11px] text-slate-500 leading-snug">{meta.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Invite form — only OWNER and ADMIN */}
      {canManage && (
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Invite Member
          </h2>
          <form onSubmit={handleInvite} className="flex flex-wrap gap-3 items-end">
            <label className="flex-1 min-w-[200px] block text-xs text-slate-500">
              Email address
              <input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="input-premium mt-1 block w-full"
              />
            </label>
            <label className="block text-xs text-slate-500">
              Role
              <div className="mt-1">
                <RoleSelect
                  value={inviteRole}
                  options={assignableRoles(myRole)}
                  onChange={setInviteRole}
                />
              </div>
            </label>
            <button
              type="submit"
              id="invite-submit"
              disabled={inviteMutation.isPending || !inviteEmail}
              className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {inviteMutation.isPending ? 'Inviting…' : 'Send Invite'}
            </button>
          </form>
          {inviteError && (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600">
              <AlertTriangle className="w-3.5 h-3.5" /> {inviteError}
            </p>
          )}
          {inviteMutation.isSuccess && (
            <p className="text-xs text-emerald-600">Member added successfully!</p>
          )}
        </section>
      )}

      {/* Members table */}
      <section className="glass-panel overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Members ({members.length})
          </h2>
          {membersQuery.isError && (
            <button onClick={() => void membersQuery.refetch()} className="text-xs text-rose-600 underline">
              Retry
            </button>
          )}
        </div>

        {membersQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400 animate-pulse">Loading members…</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No members found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-dark-850/50">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Member</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Role</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Joined</th>
                  {canManage && (
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                {members.map((member) => {
                  const isMe = member.userId === currentUser?.id;
                  const isEditing = editingMemberId === member.id;
                  const memberRole = member.role as WorkspaceRole;
                  const allowEdit = canManage && canEditRole(myRole, memberRole) && !isMe;
                  const allowRemove = canManage && canRemoveMember(myRole, memberRole) && !isMe;
                  const memberName = member.user?.name ?? member.invitedEmail ?? 'Unknown';
                  const memberEmail = member.user?.email ?? member.invitedEmail ?? '—';

                  return (
                    <tr key={member.id} className={`transition-colors ${isMe ? 'bg-primary-50/30 dark:bg-primary-500/5' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'}`}>
                      {/* Name / Email */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-indigo-500 flex items-center justify-center font-bold text-xs text-white flex-shrink-0">
                            {initials(memberName)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                              {memberName} {isMe && <span className="text-[10px] text-primary-500 font-normal">(you)</span>}
                            </p>
                            <p className="text-xs text-slate-400">{memberEmail}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <RoleSelect
                              value={editRole}
                              options={assignableRoles(myRole)}
                              onChange={setEditRole}
                            />
                            <button
                              id={`save-role-${member.id}`}
                              onClick={() => handleSaveRole(member.id)}
                              disabled={updateRoleMutation.isPending}
                              className="btn-primary px-2 py-1 text-xs disabled:opacity-50"
                            >
                              {updateRoleMutation.isPending ? '…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingMemberId(null)}
                              className="text-xs text-slate-400 hover:text-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <RoleBadge role={memberRole} />
                            {allowEdit && (
                              <button
                                id={`edit-role-${member.id}`}
                                onClick={() => handleStartEdit(member)}
                                className="text-[10px] text-slate-400 hover:text-primary-600 underline"
                              >
                                change
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          member.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                        }`}>
                          {member.status === 'ACTIVE' ? 'Active' : 'Invited'}
                        </span>
                      </td>

                      {/* Joined */}
                      <td className="px-5 py-3 text-xs text-slate-400">
                        {formatDate(member.joinedAt ?? member.createdAt)}
                      </td>

                      {/* Actions */}
                      {canManage && (
                        <td className="px-5 py-3 text-right">
                          {allowRemove && (
                            <button
                              id={`remove-member-${member.id}`}
                              onClick={() => handleRemove(member)}
                              disabled={removeMutation.isPending}
                              title="Remove member"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
