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
  }, { userId: 1, role: Role.ADMIN });

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
        closedAt: null,
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

test("receptionist user listing is limited to patients", async () => {
  const calls: unknown[] = [];
  const prisma = {
    user: {
      findMany: async (input: unknown) => {
        calls.push({ method: "findMany", input });
        return [];
      },
      count: async (input: unknown) => {
        calls.push({ method: "count", input });
        return 0;
      },
    },
  };
  const service = new UsersService(prisma as never);

  await service.listUsers(
    {
      role: Role.ADMIN,
      search: "medislot",
      page: 1,
      pageSize: 10,
    },
    { userId: 9, role: Role.RECEPTIONIST },
  );

  assert.deepStrictEqual(calls, [
    {
      method: "findMany",
      input: {
        where: {
          role: Role.PATIENT,
          OR: [
            { name: { contains: "medislot", mode: "insensitive" } },
            { email: { contains: "medislot", mode: "insensitive" } },
          ],
        },
        orderBy: { id: "asc" },
        skip: 0,
        take: 10,
      },
    },
    {
      method: "count",
      input: {
        where: {
          role: Role.PATIENT,
          OR: [
            { name: { contains: "medislot", mode: "insensitive" } },
            { email: { contains: "medislot", mode: "insensitive" } },
          ],
        },
      },
    },
  ]);
});

test("patients cannot read another user's profile", async () => {
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 7,
        role: Role.PATIENT,
      }),
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

test("receptionists cannot read admin profile information", async () => {
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 1,
        role: Role.ADMIN,
      }),
    },
  };
  const service = new UsersService(prisma as never);

  await assert.rejects(
    () => service.getUserById(1, { userId: 9, role: Role.RECEPTIONIST }),
    (error) => {
      assert.ok(error instanceof ForbiddenException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "You can only access allowed user information",
        code: "FORBIDDEN",
      });
      return true;
    },
  );
});

test("managers can read their own profile but not another user's profile", async () => {
  const users = [
    { id: 20, name: "Test Manager", email: "manager@example.test", role: Role.MANAGER, password: "secret" },
    { id: 21, name: "Test Patient", email: "patient@example.test", role: Role.PATIENT, password: "secret" },
  ];
  const service = new UsersService({
    user: { findUnique: async ({ where }: { where: { id: number } }) => users.find(({ id }) => id === where.id) },
  } as never);
  const caller = { userId: 20, role: Role.MANAGER };
  const own = await service.getUserById(20, caller);
  assert.equal(own.name, "Test Manager");
  assert.equal("password" in own, false);
  await assert.rejects(() => service.getUserById(21, caller), ForbiddenException);
});
