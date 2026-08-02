import { z } from "zod";

export const WriterNameSchema = z.string().trim().min(1).max(100);
export const WriterEmailSchema = z.string().trim().max(254).pipe(z.email());

export const ImdbProfileUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      return (
        url.protocol === "https:" &&
        (hostname === "imdb.com" || hostname.endsWith(".imdb.com")) &&
        /^\/name\/nm\d{7,10}\/?$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  }, "Enter a valid HTTPS IMDb name-profile URL.");

export const ProfessionalWebsiteUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        hostname !== "localhost" &&
        !hostname.endsWith(".local") &&
        hostname.includes(".")
      );
    } catch {
      return false;
    }
  }, "Enter a valid public HTTPS website URL.");

export interface WriterContact {
  firstName: string;
  lastName: string;
  email: string;
  imdbUrl?: string;
  websiteUrl?: string;
}
