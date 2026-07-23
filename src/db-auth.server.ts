import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import store from "./db-schema.server";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export interface User {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

export function createSession(userId: number): string {
  const token = generateToken();
  store.insertSession(userId, token);
  return token;
}

export function getUserFromToken(token: string): User | null {
  const session = store.findSessionByToken(token);
  if (!session) return null;

  const user = store.findUserById(session.user_id);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    created_at: user.created_at,
  };
}

export function deleteSession(token: string): void {
  store.deleteSessionByToken(token);
}

export function createUser(
  email: string,
  password: string,
  name: string,
): { user: User; token: string } {
  // Check if user already exists
  const existing = store.findUserByEmail(email);
  if (existing) {
    throw new Error("UNIQUE constraint failed: users.email");
  }

  const passwordHash = hashPassword(password);
  const userRow = store.insertUser(email, passwordHash, name);
  const token = createSession(userRow.id);

  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      created_at: userRow.created_at,
    },
    token,
  };
}

export function loginUser(
  email: string,
  password: string,
): { user: User; token: string } | null {
  const userRow = store.findUserByEmail(email);
  if (!userRow) return null;
  if (!verifyPassword(password, userRow.password_hash)) return null;

  const token = createSession(userRow.id);
  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      created_at: userRow.created_at,
    },
    token,
  };
}
