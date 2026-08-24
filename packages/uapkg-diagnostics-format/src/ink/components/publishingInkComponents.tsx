import type { PublishRequestFailedDiagnostic } from '@uapkg/diagnostics';
import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { publishFactLabels, publishResourceLabel } from '../../formatters/publishing/publishingFormatters.ts';
import type { DiagnosticBodyComponent, DiagnosticBodyProps, DiagnosticInkComponentMap } from '../contracts/InkTypes.ts';

const PublishRequestFailed: DiagnosticBodyComponent = ({ diagnostic }: DiagnosticBodyProps): ReactElement => {
  const d = diagnostic as PublishRequestFailedDiagnostic;
  return (
    <Box flexDirection="column">
      <Text>{d.message}</Text>
      {d.data.facts.map((fact) => (
        <Text key={`${fact.kind}:${fact.value}`}>
          <Text color="gray">{publishFactLabels[fact.kind]}: </Text>
          <Text color="cyan">{fact.value}</Text>
        </Text>
      ))}
      {d.data.serverCode !== undefined ? (
        <Text>
          <Text color="gray">Server code: </Text>
          <Text color="yellow">{d.data.serverCode}</Text>
        </Text>
      ) : null}
      {d.data.status !== undefined ? (
        <Text>
          <Text color="gray">HTTP status: </Text>
          <Text color="yellow">{d.data.status}</Text>
        </Text>
      ) : null}
      {d.hint ? (
        <Text>
          <Text color="magentaBright">→ </Text>
          <Text color="white">{d.hint}</Text>
        </Text>
      ) : null}
      {d.data.resources.map((resource) => (
        <Text key={`${resource.kind}:${resource.kind === 'command' ? resource.command : resource.url}`}>
          <Text color="gray">{publishResourceLabel(resource)}: </Text>
          <Text color={resource.kind === 'command' ? 'cyanBright' : 'blueBright'}>
            {resource.kind === 'command' ? resource.command : resource.url}
          </Text>
        </Text>
      ))}
    </Box>
  );
};

PublishRequestFailed.rendersHint = true;

export const publishingInkComponents: DiagnosticInkComponentMap = {
  PUBLISH_REQUEST_FAILED: PublishRequestFailed,
};
