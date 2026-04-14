import { Question, InterviewScript } from '../types';

/**
 * Load an interview script JSON file and return parsed questions + total time.
 * The JSON has keys like "q1", "q2", … each with { content, type, requirement, condition, max_sec }.
 */
export async function loadInterviewScript(
  path: string,
): Promise<{ questions: Question[]; totalTimeSec: number }> {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Failed to load interview script: ${resp.statusText}`);
  const raw: InterviewScript = await resp.json();

  const questions: Question[] = Object.entries(raw)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, q]) => ({
      id: key,
      content: q.content,
      type: q.type,
      requirement: q.requirement,
      condition: q.condition,
      max_sec: q.max_sec,
    }));

  const totalTimeSec = questions.reduce((sum, q) => sum + q.max_sec, 0);

  return { questions, totalTimeSec };
}
