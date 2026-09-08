from pathlib import Path

source = Path('app/ui/dom/stable-cupping-screen-renderer.ts')
text = source.read_text()
old = '    marker.style.width = `${Math.max(54, Math.round(hostRect.width + 13))}px`;'
new = '    marker.style.width = "calc(100% + 13px)";'
if text.count(old) != 1:
    raise SystemExit(f'expected exactly one floating-marker width assignment, got {text.count(old)}')
source.write_text(text.replace(old, new, 1))

for path in [Path('.github/workflows/oneshot-fix-float-width.yml'), Path('scripts/oneshot_fix_float_width.py')]:
    if path.exists():
        path.unlink()
