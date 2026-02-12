import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new (PrismaClient as any)();

async function main() {
  // Clean existing data
  await prisma.transaction.deleteMany();
  await prisma.user.deleteMany();

  // Create test users
  const user1 = await prisma.user.create({
    data: {
      email: "alice@casino.com",
      password: "password123",
      username: "alice",
      chipBalance: 1000,
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: "bob@casino.com",
      password: "password123",
      username: "bob",
      chipBalance: 1000,
    },
  });

  // Create initial deposit transactions
  await prisma.transaction.createMany({
    data: [
      {
        amount: 1000,
        type: "DEPOSIT",
        userId: user1.id,
      },
      {
        amount: 1000,
        type: "DEPOSIT",
        userId: user2.id,
      },
    ],
  });

  console.log("Seed completed:");
  console.log(`  - User: ${user1.username} (${user1.email}) — ${user1.chipBalance} jetons`);
  console.log(`  - User: ${user2.username} (${user2.email}) — ${user2.chipBalance} jetons`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
