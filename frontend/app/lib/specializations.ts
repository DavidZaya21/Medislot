export const SPECIALIZATIONS = {
  GENERAL_PRACTICE: "General practice",
  CARDIOLOGY: "Cardiology",
  NEUROLOGY: "Neurology",
  ORTHOPAEDICS: "Orthopaedics",
  PEDIATRICS: "Pediatrics",
  DERMATOLOGY: "Dermatology",
  OPHTHALMOLOGY: "Ophthalmology",
  ENT: "Ear, nose and throat",
  GYNAECOLOGY: "Gynaecology",
  UROLOGY: "Urology",
} as const;

export type Specialization = keyof typeof SPECIALIZATIONS;
export const specializationOptions = Object.entries(SPECIALIZATIONS) as [Specialization, string][];

export function specializationLabel(value: Specialization | null | undefined) {
  return value ? SPECIALIZATIONS[value] : "Not specified";
}
