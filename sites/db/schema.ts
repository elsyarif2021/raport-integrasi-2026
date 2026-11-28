import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
export const members = sqliteTable('raport_members', {
  userId: text('user_id').primaryKey(), email: text('email').notNull().unique(),
  name: text('name').notNull(), role: text('role').notNull(),
}, () => [check('member_role', sql`role IN ('admin', 'guru', 'wali_kelas')`)]);
export const invitations = sqliteTable('raport_invitations', {
  email: text('email').primaryKey(), name: text('name').notNull(), role: text('role').notNull(),
}, () => [check('invitation_role', sql`role IN ('admin', 'guru', 'wali_kelas')`)]);
export const loginLinks = sqliteTable('raport_login_links', {
  email: text('email').primaryKey(), tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});
export const pinAccounts = sqliteTable('raport_pin_accounts', {
  id: text('id').primaryKey(), name: text('name').notNull(), loginName: text('login_name').notNull().unique(),
  slug: text('slug').notNull().unique(), role: text('role').notNull(),
  pinHash: text('pin_hash').notNull(), pinSalt: text('pin_salt').notNull(),
  pinFingerprint: text('pin_fingerprint').unique(),
  createdAt: integer('created_at').notNull(),
}, () => [check('pin_account_role', sql`role IN ('admin', 'guru', 'wali_kelas')`)]);
export const pinBulkOperations = sqliteTable('raport_pin_bulk_operations', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), requestHash: text('request_hash').notNull(),
  resultCipher: text('result_cipher').notNull(), expiresAt: integer('expires_at').notNull(),
});
export const pinSessions = sqliteTable('raport_pin_sessions', {
  tokenHash: text('token_hash').primaryKey(), accountId: text('account_id').notNull().references(()=>pinAccounts.id,{onDelete:'cascade'}),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('pin_session_account').on(table.accountId)]);
export const pinAttempts = sqliteTable('raport_pin_attempts', {
  bucket: text('bucket').primaryKey(), attempts: integer('attempts').notNull(), resetAt: integer('reset_at').notNull(),
});
export const adminGuards = sqliteTable('raport_admin_guards', {
  id: text('id').primaryKey(), valid: integer('valid').notNull(),
}, () => [check('raport_admin_limit', sql`valid = 1`)]);
export const students = sqliteTable('raport_students', {
  id: text('id').primaryKey(), classId: text('class_id').notNull(), record: text('record').notNull(),
  version: integer('version').notNull().default(1),
}, table => [index('student_class').on(table.classId), check('student_json', sql`json_valid(record)`)]);
// A failed guard rolls back the entire D1 batch when another editor saved first.
export const writeGuards = sqliteTable('raport_write_guards', {
  id: text('id').primaryKey(), valid: integer('valid').notNull(),
}, () => [check('raport_write_conflict', sql`valid = 1`)]);

export const googleAdmins = sqliteTable('raport_google_admins', {
  googleSub: text('google_sub').primaryKey(), email: text('email').notNull().unique(),
  name: text('name').notNull(), createdAt: integer('created_at').notNull(),
});
export const googleSessions = sqliteTable('raport_google_sessions', {
  tokenHash: text('token_hash').primaryKey(), googleSub: text('google_sub').notNull().references(()=>googleAdmins.googleSub,{onDelete:'cascade'}),
  expiresAt: integer('expires_at').notNull(),
}, table=>[index('google_session_expiry').on(table.expiresAt)]);
export const googleOperations = sqliteTable('raport_google_operations', {
  id:text('id').primaryKey(), expiresAt:integer('expires_at').notNull(),
});
