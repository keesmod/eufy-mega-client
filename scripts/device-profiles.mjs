import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { deviceProfiles, h3MediaOwner, profileEvidence } from '../dist/device-profiles.js';

const document = new URL('../docs/DEVICE_PROFILES.md', import.meta.url);
const start = '<!-- generated device profiles: start -->';
const end = '<!-- generated device profiles: end -->';

export async function renderDeviceProfiles(text) {
  const rows = Object.entries(deviceProfiles).map(([model, profile]) => {
    const { type, kind, family, topology, features } = profile;
    return `| ${model} | ${type} | ${kind} | ${family} | ${topology} | ${features.snapshot} | ${features.live} | ${features.recordings} | [Evidence](${profileEvidence[family]}) |`;
  });
  const table = [
    `H3 media requires the actual ${h3MediaOwner.model}/type ${deviceProfiles[h3MediaOwner.model].type} owner,`,
    `a matching parent and ${h3MediaOwner.model} serial prefix, and four-part numeric`,
    `owner firmware at or above ${h3MediaOwner.minimumFirmware.join('.')}.`,
    '',
    '| Model | Type | Kind | Family | Discovery topology | Snapshot | Live | Recordings | Software evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    ...Object.entries(deviceProfiles)
      .filter(([, profile]) => profile.reportedTypes)
      .flatMap(([model, profile]) => [
        '',
        `${model} also admits the reported type ${profile.reportedTypes.join(', ')} with the same policy.`,
        'See [MODEL_MATRIX.md](MODEL_MATRIX.md) for the report.',
      ]),
  ].join('\n');
  const sections = text.split(start);
  if (sections.length !== 2 || sections[1].split(end).length !== 2)
    throw new Error('Expected one device-profile generation block');
  return format(`${sections[0]}${start}\n\n${table}\n\n${end}${sections[1].split(end)[1]}`, {
    parser: 'markdown',
    printWidth: 100,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = await readFile(document, 'utf8');
  const rendered = await renderDeviceProfiles(text);
  if (process.argv.includes('--write')) await writeFile(document, rendered);
  else if (text !== rendered)
    throw new Error('Run node scripts/device-profiles.mjs --write after building');
}
