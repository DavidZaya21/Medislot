import type { Role } from "@prisma/client";

export type AuthUser = {
  userId: number;
  role: Role;
};
