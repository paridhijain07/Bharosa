import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Recognizes speech from a 16-bit PCM WAV file using Windows built-in offline
 * System.Speech.Recognition.SpeechRecognitionEngine (`SetInputToWaveFile`).
 * Works 100% offline in ~300ms with a custom grammar trained on the vendor's menu.
 */
export async function recognizeWavViaWindowsSpeech({
  wavBuffer,
  menu = [],
  customers = [],
} = {}) {
  if (!wavBuffer || wavBuffer.length < 1000) {
    return { recognized: false, transcript: '' };
  }

  const tmpWavPath = path.join(
    os.tmpdir(),
    `bharosa_voice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`
  );

  try {
    await fs.writeFile(tmpWavPath, wavBuffer);

    const itemPhrases = new Set([
      'chaat',
      'chai',
      'tea',
      'coffee',
      'cold coffee',
      'samosa',
      'lassi',
      'vada pav',
      'kachori',
      'masala dosa',
      'dosa',
      'maggi',
      'paneer roll',
      'veg sandwich',
      'sandwich',
      'iced tea',
      'lemon tea',
      'ginger tea',
      'mango shake',
      'banana shake',
      'oreo shake',
      'oreo crumble shake',
      'kit kat shake',
      'strawberry shake',
      'vanilla shake',
      'pineapple shake',
      'butterscotch shake',
      'shikanji',
      'jaljeera',
      'bournvita',
      'nimbu pani',
    ]);

    for (const m of menu) {
      const cleanName = String(m.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanName && cleanName.length >= 2) {
        itemPhrases.add(cleanName);
      }
      for (const a of m.aliases || []) {
        const cleanAlias = String(a || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleanAlias && cleanAlias.length >= 3) {
          itemPhrases.add(cleanAlias);
        }
      }
    }

    const custNames = new Set(['raju', 'sunita', 'amit', 'mohan']);
    for (const c of customers) {
      const cleanCust = String(c.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
      if (cleanCust && cleanCust.length >= 2) {
        custNames.add(cleanCust);
      }
    }

    const itemsPsArray = Array.from(itemPhrases)
      .map((s) => `'${s.replace(/'/g, "''")}'`)
      .join(', ');
    const custsPsArray = Array.from(custNames)
      .map((s) => `'${s.replace(/'/g, "''")}'`)
      .join(', ');
    const escapedWavPath = tmpWavPath.replace(/'/g, "''");

    const psScript = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $nums = @('one', 'two', 'three', 'four', 'five', 'six', 'ek', 'do', 'teen', 'chaar', 'paanch')
  $items = @(${itemsPsArray})
  $custs = @(${custsPsArray})

  $singleItem = New-Object System.Speech.Recognition.GrammarBuilder
  $singleItem.Append((New-Object System.Speech.Recognition.Choices($nums)), 0, 1)
  $singleItem.Append((New-Object System.Speech.Recognition.Choices($items)))

  $allChoices = New-Object System.Speech.Recognition.Choices
  $allChoices.Add($singleItem)

  $twoItems = New-Object System.Speech.Recognition.GrammarBuilder
  $twoItems.Append($singleItem)
  $twoItems.Append((New-Object System.Speech.Recognition.Choices(@('and', 'aur', 'plus', 'with'))), 0, 1)
  $twoItems.Append($singleItem)
  $allChoices.Add($twoItems)

  $khataPrefix = New-Object System.Speech.Recognition.GrammarBuilder
  $khataPrefix.Append((New-Object System.Speech.Recognition.Choices($custs)))
  $khataPrefix.Append((New-Object System.Speech.Recognition.Choices(@('ka khata', 'ke khate mein', 'khata', 'udhaar'))), 0, 1)
  $khataPrefix.Append($singleItem)
  $khataPrefix.Append((New-Object System.Speech.Recognition.Choices(@('khata', 'udhaar'))), 0, 1)
  $allChoices.Add($khataPrefix)

  $khataSuffix = New-Object System.Speech.Recognition.GrammarBuilder
  $khataSuffix.Append($singleItem)
  $khataSuffix.Append((New-Object System.Speech.Recognition.Choices($custs)))
  $khataSuffix.Append((New-Object System.Speech.Recognition.Choices(@('ka khata', 'ke khate mein', 'khata', 'udhaar'))), 0, 1)
  $allChoices.Add($khataSuffix)

  $usualPhrase = New-Object System.Speech.Recognition.GrammarBuilder
  $usualPhrase.Append((New-Object System.Speech.Recognition.Choices($custs)))
  $usualPhrase.Append((New-Object System.Speech.Recognition.Choices(@('ka roz wala', 'roz wala', 'usual', 'ka usual'))))
  $allChoices.Add($usualPhrase)

  $assistantChoices = New-Object System.Speech.Recognition.Choices(@(
    'aaj kitna aaya',
    'how much is collected today',
    'how much is pending',
    'kitna baki hai',
    'kaun kaun udhaar mein hai',
    'who is on khata',
    'raju ka kitna baki hai',
    'sabse zyada bheed kab thi'
  ))
  $allChoices.Add($assistantChoices)

  $gb = New-Object System.Speech.Recognition.GrammarBuilder($allChoices)
  $g = New-Object System.Speech.Recognition.Grammar($gb)
  $rec.LoadGrammar($g)

  $rec.SetInputToWaveFile('${escapedWavPath}')
  $result = $rec.Recognize()
  $rec.Dispose()

  if ($null -ne $result -and $result.Text -and $result.Confidence -ge 0.35) {
    $out = @{ recognized = $true; transcript = $result.Text; confidence = $result.Confidence } | ConvertTo-Json -Compress
    Write-Output $out
  } else {
    Write-Output '{"recognized":false,"transcript":""}'
  }
} catch {
  $errOut = @{ recognized = $false; transcript = ''; error = $_.Exception.Message } | ConvertTo-Json -Compress
  Write-Output $errOut
}
`;

    return await new Promise((resolve) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        windowsHide: true,
      });

      let stdout = '';
      ps.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      ps.on('close', () => {
        fs.unlink(tmpWavPath).catch(() => {});
        const lines = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('{') && l.endsWith('}'));
        const lastJson = lines[lines.length - 1];
        if (lastJson) {
          try {
            return resolve(JSON.parse(lastJson));
          } catch {
            // ignore
          }
        }
        return resolve({ recognized: false, transcript: '' });
      });

      ps.on('error', (err) => {
        fs.unlink(tmpWavPath).catch(() => {});
        resolve({ recognized: false, transcript: '', error: err.message });
      });
    });
  } catch (err) {
    await fs.unlink(tmpWavPath).catch(() => {});
    return { recognized: false, transcript: '', error: err.message };
  }
}
