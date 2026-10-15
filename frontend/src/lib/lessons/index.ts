import type { Lesson } from "./types";

/** Every lesson, in teaching order. The content is in ./content. */
export const LESSONS: Lesson[] = [];

export const lessonById = (id: string, lessons: Lesson[] = LESSONS): Lesson | undefined => lessons.find((l) => l.id === id);
