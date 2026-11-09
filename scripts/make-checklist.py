#!/usr/bin/env python3
# Generate FILE-CHECKLIST-v7.8.txt from the current ZIP and verify critical files exist.
import zipfile

zp = '/home/z/my-project/download/SMC-Sniper-App.zip'
out = '/home/z/my-project/download/FILE-CHECKLIST-v7.8.txt'

z = zipfile.ZipFile(zp)
names = sorted(i.filename for i in z.infolist() if not i.filename.endswith('/'))

must = [
    'src/lib/smc/livereport.ts',
    'src/lib/smc/tfpositions.ts',
    'src/lib/smc/dom.ts',
    'src/lib/smc/priceaction.ts',
    'src/lib/smc/consensus.ts',
    'src/lib/smc/server.ts',
    'src/app/api/dom/route.ts',
    'src/components/smc/SmartMoneyCard.tsx',
    'src/components/smc/TfPositionsCard.tsx',
    'src/components/smc/PriceActionCard.tsx',
    'src/components/smc/ZonesPanel.tsx',
    'src/hooks/use-panel-fs.ts',
    'src/hooks/use-dom.ts',
    'src/lib/tv/client.ts',
    'data/perf-demo.json',
]
missing = [m for m in must if m not in names]
if missing:
    raise SystemExit('MISSING FROM ZIP: ' + ', '.join(missing))

n_lib = sum(1 for n in names if n.startswith('src/lib/smc/') and n.endswith('.ts'))
n_comp = sum(1 for n in names if n.startswith('src/components/smc/') and n.endswith('.tsx'))
assert n_lib == 11, f'src/lib/smc has {n_lib} ts files, expected 11'
assert n_comp == 20, f'src/components/smc has {n_comp} tsx files, expected 20'

lines = [
    'چک‌لیست کامل فایل‌های SMC-Sniper-App نسخهٔ v7.8',
    f'برای دیپلوی روی Vercel/گیت‌هاب: همهٔ فایل‌های زیر باید در پروژه باشند (مجموعاً {len(names)} فایل).',
    'اگر بیلد Vercel خطای «Module not found» داد، یعنی یکی از این فایل‌ها در پروژهٔ شما نیست —',
    'کل پروژه را با محتوای ZIP جدید جایگزین کنید (راهنما: DEPLOY-GITHUB-FA.md).',
    '',
    '★ فایل‌های جدید که نبودشان همین ارور را می‌دهد:',
]
lines += ['   ' + m for m in must]
lines += [
    '',
    f'★ src/lib/smc/ باید دقیقاً {n_lib} فایل .ts داشته باشد و src/components/smc/ دقیقاً {n_comp} فایل .tsx',
    '',
    f'── لیست کامل ({len(names)} فایل) ──',
]
lines += names
open(out, 'w').write('\n'.join(lines) + '\n')
print(f'checklist OK: {len(names)} files, lib={n_lib}, components={n_comp}, all critical present')
