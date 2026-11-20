import assert from "node:assert/strict";
import test from "node:test";
import { Specialization } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateDoctorDto, UpdateDoctorDto, DoctorListQueryDto } from "../src/doctors/doctors.dto";
import { serializeDoctor } from "../src/common/serializers";
import { DoctorsService } from "../src/doctors/doctors.service";

test("doctor create/edit/filter require enum specialization values", async () => {
  for (const specialization of Object.values(Specialization)) {
    for (const dto of [CreateDoctorDto, UpdateDoctorDto, DoctorListQueryDto]) {
      const errors = await validate(plainToInstance(dto, { name: "Doctor", email: "test@example.test", password: "password123", specialization }));
      assert.equal(errors.length, 0);
    }
  }
  for (const specialization of ["neuro", "Cardiology", "", "CARD", "UNKNOWN", null, undefined]) {
    for (const dto of [CreateDoctorDto, UpdateDoctorDto]) {
      assert.ok((await validate(plainToInstance(dto, { name: "Doctor", email: "test@example.test", password: "password123", specialization }))).some(e => e.property === "specialization"));
    }
  }
  for (const specialization of ["neuro", "CARD", ""]) {
    assert.ok((await validate(plainToInstance(DoctorListQueryDto, { specialization }))).length);
  }
});

test("specialization filter is exact enum equality", async () => {
  let query: unknown;
  const service = new DoctorsService({ user: { findMany: async (args: unknown) => { query = args; return []; } } } as never);
  await service.listDoctors({ specialization: Specialization.ENT });
  assert.deepEqual(query, { where: { role: "DOCTOR", specialization: Specialization.ENT }, orderBy: { id: "asc" } });
});

test("doctor serialization preserves enum codes and explicit legacy nulls", () => {
  for (const specialization of [Specialization.ENT, null]) {
    const doctor = serializeDoctor({ id: 1, name: "Test", email: "test@example.test", password: "hidden",
      role: "DOCTOR", specialization, createdAt: new Date(0), updatedAt: new Date(0) });
    assert.equal(doctor.specialization, specialization);
    assert.equal(doctor.user.specialization, specialization);
    assert.equal("password" in doctor.user, false);
  }
});
