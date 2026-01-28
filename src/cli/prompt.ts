/**
 * Interactive CLI prompt helpers using node:readline/promises
 *
 * Zero-dependency (Node 18+ built-in) readline utilities for the setup wizard.
 * Supports hidden password input via muted readline output.
 */

import * as readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';

/**
 * Create a readline interface for interactive prompts
 */
export function createInterface(): readline.Interface {
  return readline.createInterface({ input: stdin, output: stdout });
}

/**
 * Ask a simple question with optional default value
 */
export async function ask(
  rl: readline.Interface,
  question: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || defaultValue || '';
}

/**
 * Ask for a password with hidden input (nothing displayed while typing)
 *
 * Uses a temporary readline with muted output to prevent echo,
 * similar to how `sudo` handles password input.
 * Falls back to normal readline when stdin is not a TTY.
 */
export async function askPassword(
  rl: readline.Interface,
  question: string,
): Promise<string> {
  if (!stdin.isTTY) {
    return ask(rl, question);
  }

  // Pause the main readline to avoid interference
  rl.pause();

  // Create a muted output stream that discards all writes (suppresses echo)
  const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });

  // Temporary readline with muted output — terminal: true enables line editing
  const tmpRl = readline.createInterface({
    input: stdin,
    output: muted,
    terminal: true,
  });

  stdout.write(`${question}: `);
  const answer = await tmpRl.question('');
  tmpRl.close();

  stdout.write('\n');
  rl.resume();

  return answer;
}

/**
 * Display a numbered list and ask the user to choose one item
 *
 * @param rl - Readline interface
 * @param header - Header text above the list
 * @param items - Array of display strings
 * @param allowAll - If true, adds an "(All)" option that returns -1
 * @returns Selected index (0-based), or -1 if "All" was chosen
 */
export async function askChoice(
  rl: readline.Interface,
  header: string,
  items: string[],
  allowAll = false,
): Promise<number> {
  console.log(`\n${header}`);
  items.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item}`);
  });
  if (allowAll) {
    console.log(`  ${items.length + 1}. (All)`);
  }

  const max = allowAll ? items.length + 1 : items.length;

  while (true) {
    const answer = await ask(rl, `Choose [1-${max}]`);
    const n = parseInt(answer, 10);
    if (n >= 1 && n <= max) {
      if (allowAll && n === max) return -1;
      return n - 1;
    }
    console.log(`  Please enter a number between 1 and ${max}.`);
  }
}

/**
 * Ask a yes/no question
 *
 * @param rl - Readline interface
 * @param question - The question text
 * @param defaultYes - If true (default), Enter means "yes"
 * @returns true for yes, false for no
 */
export async function askYesNo(
  rl: readline.Interface,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(rl, `${question} ${hint}`);
  if (answer === '') return defaultYes;
  return answer.toLowerCase().startsWith('y');
}
