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
 * Ask for a password with masked input (asterisks displayed while typing)
 *
 * Uses raw mode to capture keystrokes individually and display asterisks.
 * Supports backspace to delete characters.
 * Falls back to normal readline when stdin is not a TTY.
 */
export async function askPassword(
  rl: readline.Interface,
  question: string,
): Promise<string> {
  if (!stdin.isTTY) {
    return ask(rl, question);
  }

  // Close the main readline completely to avoid interference
  rl.pause();

  // Remove all listeners from stdin to prevent readline from echoing
  const oldListeners = stdin.listeners('data');
  stdin.removeAllListeners('data');

  stdout.write(`${question}: `);

  return new Promise((resolve) => {
    let password = '';

    // Enable raw mode to capture individual keystrokes (disables echo)
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (char: string) => {
      // Handle special characters
      switch (char) {
        case '\r': // Enter
        case '\n':
          cleanup();
          stdout.write('\n');
          resolve(password);
          break;

        case '\u0003': // Ctrl+C
          cleanup();
          stdout.write('\n');
          process.exit(0);
          break;

        case '\u007F': // Backspace (macOS/Linux)
        case '\b':     // Backspace (Windows)
          if (password.length > 0) {
            password = password.slice(0, -1);
            // Move cursor back, overwrite with space, move back again
            stdout.write('\b \b');
          }
          break;

        default:
          // Only accept printable characters
          if (char.charCodeAt(0) >= 32) {
            password += char;
            stdout.write('*');
          }
          break;
      }
    };

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener('data', onData);
      // Restore old listeners
      for (const listener of oldListeners) {
        stdin.on('data', listener as (...args: unknown[]) => void);
      }
      rl.resume();
    };

    stdin.on('data', onData);
  });
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
