import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** COMPOSE TAILWIND CLASSES — THE ONLY ALLOWED WAY TO BUILD DYNAMIC CLASS STRINGS */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
