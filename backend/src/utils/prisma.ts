import { PrismaClient } from '@prisma/client';

const datasourceUrl = process.env.DATABASE_URL;
const prisma = datasourceUrl
  ? new PrismaClient({ datasources: { db: { url: datasourceUrl } } })
  : new PrismaClient();

export default prisma;