import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...c: ClassValue[]) => twMerge(clsx(c));
