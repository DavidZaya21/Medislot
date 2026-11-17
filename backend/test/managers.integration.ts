import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("only admins can create manager accounts and managers can sign in", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/medislot_manager_test", "Use a disposable, migrated database");
  process.env.DATABASE_URL = url.href;
  const jwtSecret = "medislot-manager-integration-test";
  process.env.JWT_SECRET = jwtSecret;

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const prisma = app.get(PrismaService);
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await prisma.$disconnect();
    }
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  assert.equal(await prisma.user.count(), 0, "Use a freshly migrated database");
  const password = "integration-test-password";
  const hash = await bcrypt.hash(password, 4);
  const roles = ["ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT"] as const;
  await prisma.user.createMany({ data: roles.map((role) => ({
    role,
    name: role,
    email: `${role.toLowerCase()}@example.test`,
    password: hash,
  })) });

  async function post(path: string, body: object, token?: string) {
    const res = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: await res.json() };
  }

  async function signIn(email: string) {
    const session = await post("/sessions", { email, password });
    assert.equal(session.status, 201);
    assert.equal(typeof session.body.accessToken, "string");
    return session.body.accessToken as string;
  }

  const account = { name: "Test Manager", email: "manager@example.test", password };
  assert.equal((await post("/managers", account)).status, 401);
  for (const role of roles.slice(1)) {
    const token = await signIn(`${role.toLowerCase()}@example.test`);
    const denied = await post("/managers", account, token);
    assert.equal(denied.status, 403, role);
    assert.equal(denied.body.code, "FORBIDDEN");
    t.diagnostic(`${role} create: HTTP ${denied.status}`);
  }
  assert.equal(await prisma.user.count({ where: { role: "MANAGER" } }), 0);

  const adminToken = await signIn("admin@example.test");
  const created = await post("/managers", { ...account, role: "ADMIN" }, adminToken);
  assert.equal(created.status, 201);
  assert.equal(created.body.role, "MANAGER");
  assert.equal(created.body.password, undefined);
  const stored = await prisma.user.findUniqueOrThrow({ where: { email: account.email } });
  assert.equal(stored.id, created.body.id);
  assert.equal(stored.role, "MANAGER");
  assert.notEqual(stored.password, password);

  const managerToken = await signIn(account.email);
  const claims = jwt.verify(managerToken, jwtSecret);
  assert.equal(typeof claims === "string" ? undefined : claims.role, "MANAGER");
  const managerDenied = await post("/managers", { ...account, email: "other@example.test" }, managerToken);
  assert.equal(managerDenied.status, 403);
  t.diagnostic(`Admin create: HTTP ${created.status}; stored role and sign-in token: MANAGER; manager create: HTTP ${managerDenied.status}`);
});
