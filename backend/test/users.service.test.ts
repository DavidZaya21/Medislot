import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";

import { UsersService } from "../src/users/users.service";

test("user listing paginates after applying role and search filters", async () => {
  const createdAt = new Date("2026-05-26T10:00:00.000Z");
  const updatedAt = new Date("2026-05-26T10:00:00.000Z");
  const calls: unknown[] = [];
  const prisma = {
    user: {
      findMany: async (input: unknown) => {
        calls.push({ method: "findMany", input });
        return [
          {
            id: 7,
            name: "Anna Kowalska",
            email: "anna@example.com",
            password: "hashed-password",
            role: Role.PATIENT,
            specialization: null,
            createdAt,
            updatedAt,
          },
        ];
      },
      count: async (input: unknown) => {
        calls.push({ method: "count", input });
        return 11;
      },
    },
  };
  const service = new UsersService(prisma as never);

  const result = await service.listUsers({
    role: Role.PATIENT,
    search: "anna",
    page: 2,
    pageSize: 5,
  });

  assert.deepStrictEqual(calls, [
    {
      method: "findMany",
      input: {
        where: {
          role: Role.PATIENT,
          OR: [
            { name: { contains: "anna", mode: "insensitive" } },
            { email: { contains: "anna", mode: "insensitive" } },
          ],
        },
        orderBy: { id: "asc" },
        skip: 5,
        take: 5,
      },
    },
    {
      method: "count",
      input: {
        where: {
          role: Role.PATIENT,
          OR: [
            { name: { contains: "anna", mode: "insensitive" } },
            { email: { contains: "anna", mode: "insensitive" } },
          ],
        },
      },
    },
  ]);
  assert.deepStrictEqual(result, {
    data: [
      {
        id: 7,
        name: "Anna Kowalska",
        email: "anna@example.com",
        role: Role.PATIENT,
        specialization: null,
        createdAt,
        updatedAt,
      },
    ],
    meta: {
      page: 2,
      pageSize: 5,
      total: 11,
      totalPages: 3,
    },
  });
});

test("patients cannot read another user's profile", async () => {
  const prisma = {
    user: {
      findUnique: async () => {
        throw new Error("patient access should fail before querying");
      },
    },
  };
  const service = new UsersService(prisma as never);

  await assert.rejects(
    () => service.getUserById(7, { userId: 3, role: Role.PATIENT }),
    (error) => {
      assert.ok(error instanceof ForbiddenException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "Patients can only access their own user information",
        code: "FORBIDDEN",
      });
      return true;
    },
  );
});
