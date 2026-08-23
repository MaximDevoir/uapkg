import { Box, render, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import isCI from 'is-ci';
import { useState } from 'react';
import type { PromptService, SelectOption } from './PromptService.js';

// ---------------------------------------------------------------------------
// InkPromptService — renders interactive prompts via Ink/React.
//
// Auto-detects non-interactive environments (no TTY or CI) and returns the
// supplied fallback without ever rendering.
// ---------------------------------------------------------------------------

export class InkPromptService implements PromptService {
  public constructor(private readonly isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isCI) {}

  public async select(message: string, options: SelectOption[], fallbackValue: string): Promise<string> {
    if (!this.isInteractive) {
      return fallbackValue;
    }
    return await new Promise<string>((resolve) => {
      const app = render(<SelectPrompt message={message} options={options} onSubmit={(value) => resolve(value)} />);
      void Promise.resolve().then(() => app.waitUntilExit());
    });
  }

  public async text(message: string, initialValue: string): Promise<string> {
    if (!this.isInteractive) {
      return initialValue;
    }
    return await new Promise<string>((resolve) => {
      const app = render(
        <TextPrompt message={message} initialValue={initialValue} onSubmit={(value) => resolve(value)} />,
      );
      void Promise.resolve().then(() => app.waitUntilExit());
    });
  }

  public async secret(message: string): Promise<string> {
    if (!this.isInteractive) {
      throw new Error(`${message} requires an interactive terminal.`);
    }
    return await new Promise<string>((resolve) => {
      const app = render(<SecretPrompt message={message} onSubmit={(value) => resolve(value)} />);
      void Promise.resolve().then(() => app.waitUntilExit());
    });
  }
}

function SecretPrompt({ message, onSubmit }: { message: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');
  const { exit } = useApp();

  useInput((_, key) => {
    if (key.return) {
      onSubmit(value.trim());
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{message}</Text>
      <TextInput value={value} onChange={setValue} mask="*" />
    </Box>
  );
}

function SelectPrompt({
  message,
  options,
  onSubmit,
}: {
  message: string;
  options: SelectOption[];
  onSubmit: (value: string) => void;
}) {
  const { exit } = useApp();
  return (
    <Box flexDirection="column">
      <Text>{message}</Text>
      <SelectInput
        items={options}
        onSelect={(item) => {
          onSubmit(item.value);
          exit();
        }}
      />
    </Box>
  );
}

function TextPrompt({
  message,
  initialValue,
  onSubmit,
}: {
  message: string;
  initialValue: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const { exit } = useApp();

  useInput((_, key) => {
    if (key.return) {
      onSubmit(value.trim() || initialValue);
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{message}</Text>
      <TextInput value={value} onChange={setValue} />
      <Text color="gray">Press Enter to confirm.</Text>
    </Box>
  );
}
