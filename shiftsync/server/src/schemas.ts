import { z } from "zod";
import {
  CATEGORIES,
  CONFLICT_STATUSES,
  CONTACT_ROLES,
  PROFILE_ROLES,
} from "../../src/domain/persistence";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
export const id = z.uuid();

const deadline = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Use YYYY-MM-DDTHH:mm");
// Field rules without defaults, so a partial update never resets fields
// the client did not send.
const itemFields = {
  kind: z.enum(["event", "shift", "task", "unavailable"]),
  title: z.string().trim().min(1, "Add a title").max(120),
  date,
  start: time,
  end: time,
  category: z.enum(CATEGORIES),
  location: z.string().max(200),
  notes: z.string().max(2000),
  participants: z.string().max(500),
  reminder: z.string().max(60),
  repeat: z.enum(["Never", "Daily", "Weekly"]),
  exceptions: z.array(date).max(500),
  priority: z.enum(["Low", "Medium", "High"]),
  completed: z.boolean(),
  completedDates: z.array(date).max(1000),
  status: z.enum(["Confirmed", "Open", "Cancelled"]),
  position: z.string().max(120),
  swapRequested: z.boolean(),
  fixed: z.boolean(),
  deadline,
  splittable: z.boolean(),
  minBlockMinutes: z.number().int().min(5).max(480),
  contactIds: z.array(id).max(10),
};
export const itemSchema = z.object({
  ...itemFields,
  id,
  location: itemFields.location.default(""),
  notes: itemFields.notes.default(""),
  participants: itemFields.participants.default(""),
  reminder: itemFields.reminder.default("None"),
  repeat: itemFields.repeat.default("Never"),
  exceptions: itemFields.exceptions.optional(),
  priority: itemFields.priority.default("Medium"),
  completed: itemFields.completed.default(false),
  completedDates: itemFields.completedDates.optional(),
  status: itemFields.status.default("Confirmed"),
  position: itemFields.position.default(""),
  swapRequested: itemFields.swapRequested.default(false),
  fixed: itemFields.fixed.optional(),
  deadline: deadline.optional(),
  splittable: itemFields.splittable.optional(),
  minBlockMinutes: itemFields.minBlockMinutes.optional(),
  contactIds: itemFields.contactIds.optional(),
});
export const eventCreateSchema = itemSchema;
/** Only the fields sent change. `deadline: null` removes the deadline. */
export const eventPatchSchema = z.object(itemFields).partial().extend({
  deadline: deadline.nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const contactSchema = z.object({
  id,
  name: z.string().trim().min(1, "Add a name").max(120),
  email: z.email("Enter a valid email address").max(254),
  role: z.enum(CONTACT_ROLES),
});
export const contactPatchSchema = contactSchema.omit({ id: true }).partial();

export const settingsPatchSchema = z.object({
  profile: z
    .object({
      name: z.string().trim().min(1).max(120),
      organization: z.string().max(120).default(""),
      roles: z
        .array(z.enum(PROFILE_ROLES))
        .max(PROFILE_ROLES.length)
        .optional(),
      // Earlier app versions send their single choice as `role`.
      role: z.enum(PROFILE_ROLES).optional(),
    })
    .transform(({ role, roles, ...profile }) => {
      const chosen = roles ?? (role ? [role] : undefined);
      return chosen ? { ...profile, roles: [...new Set(chosen)] } : profile;
    })
    .optional(),
  onboarded: z.boolean().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  availability: z.array(z.unknown()).optional(),
});

export const slotSchema = z.object({ date, start: time, end: time });
export const analyzeSchema = z.object({
  shift: itemSchema,
  horizonDays: z.number().int().min(1).max(14).optional(),
});
export const suggestionsSchema = z.object({
  eventId: id,
  occurrenceDate: date,
  conflictId: z.string().max(200).optional(),
  reserved: z.array(slotSchema).max(20).optional(),
});
export const conflictStatusSchema = z.object({
  status: z.enum(CONFLICT_STATUSES as [string, ...string[]]),
});
// Explanations are always built from facts the server computes itself.
export const explainSchema = z.union([
  z.object({ conflictId: z.string().min(1).max(200) }),
  analyzeSchema,
]);
export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(1500),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (list) => list[list.length - 1].role === "user",
      "The last message must be from the student",
    ),
});
export const draftSchema = z.object({
  conflictId: z.string().min(1).max(200),
  contactId: id,
});
const subject = z
  .string()
  .trim()
  .min(1, "Add a subject")
  .max(150)
  .refine((v) => !/[\r\n]/.test(v), "One line only");
const body = z.string().trim().min(1, "Add a message").max(5000);
export const gmailDraftSchema = z.object({ notificationId: id, subject, body });
export const gmailSendSchema = gmailDraftSchema.extend({
  confirmed: z.literal(true, "Confirm the message before sending"),
  recipientEmail: z.email().max(254),
});

export const credentialsSchema = z.object({
  email: z
    .email("Enter a valid email address")
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});
export const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1, "Enter your name").max(120),
});
export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(4096),
});
export const googleConnectSchema = z.object({
  services: z
    .array(z.enum(["calendar", "gmail"]))
    .min(1)
    .max(2),
  returnUrl: z.string().min(1).max(500),
});
export const googleLoginStartSchema = z.object({
  returnUrl: z.string().min(1).max(500),
  codeChallenge: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, "Invalid code challenge"),
});
export const googleLoginCompleteSchema = z.object({
  handle: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
});
export const googleCompleteSchema = z.object({
  handle: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
});
