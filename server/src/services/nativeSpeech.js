import { spawn } from 'node:child_process';

let activePsProcess = null;

export function cancelNativeSpeech() {
  if (activePsProcess) {
    try {
      activePsProcess.kill();
    } catch {
      // ignore
    }
    activePsProcess = null;
  }
}

/**
 * Uses Windows built-in offline System.Speech.Recognition.SpeechRecognitionEngine
 * with a dynamic grammar constrained to the vendor's active menu, Hinglish/English numerals,
 * customer names, and Khata phrases. Works 100% offline even when Chrome's cloud
 * webkitSpeechRecognition fails with `network` error.
 */
export function listenViaWindowsSpeech({ menu = [], customers = [], timeoutSec = 7 } = {}) {
  cancelNativeSpeech();

  return new Promise((resolve) => {
    // Extract clean ASCII item phrases from vendor menu
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

  $threeItems = New-Object System.Speech.Recognition.GrammarBuilder
  $threeItems.Append($singleItem)
  $threeItems.Append((New-Object System.Speech.Recognition.Choices(@('and', 'aur'))), 0, 1)
  $threeItems.Append($singleItem)
  $threeItems.Append((New-Object System.Speech.Recognition.Choices(@('and', 'aur'))), 0, 1)
  $threeItems.Append($singleItem)
  $allChoices.Add($threeItems)

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
  $g.Weight = 1.0
  $rec.LoadGrammar($g)

  $rec.SetInputToDefaultAudioDevice()
  $rec.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5.5)
  $rec.BabbleTimeout = [TimeSpan]::FromSeconds(4.0)
  $rec.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.6)
  $rec.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromSeconds(0.75)

  $result = $rec.Recognize([TimeSpan]::FromSeconds(${Number(timeoutSec) || 7}))
  $rec.Dispose()

  if ($null -ne $result -and $result.Text) {
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

    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      windowsHide: true,
    });
    activePsProcess = ps;

    let stdout = '';
    ps.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    ps.on('close', () => {
      if (activePsProcess === ps) {
        activePsProcess = null;
      }
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
      if (activePsProcess === ps) {
        activePsProcess = null;
      }
      resolve({ recognized: false, transcript: '', error: err.message });
    });
  });
}
