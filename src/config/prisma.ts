import { PrismaClient } from "../generated/prisma/client";

const prisma = new (PrismaClient as any)() as InstanceType<typeof PrismaClient>;

export default prisma;
