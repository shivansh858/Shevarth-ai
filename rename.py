import os

replacements = {
    "sevaarth": "sevaarth",
    "SEVAARTH": "SEVAARTH",
    "Sevaarth": "Sevaarth"
}

def replace_in_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return

    new_content = content
    for old, new in replacements.items():
        new_content = new_content.replace(old, new)
        
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for root, dirs, files in os.walk('.'):
    # skip directories
    if '.git' in dirs:
        dirs.remove('.git')
    if 'node_modules' in dirs:
        dirs.remove('node_modules')
    if '.venv' in dirs:
        dirs.remove('.venv')
    if '__pycache__' in dirs:
        dirs.remove('__pycache__')

    for file in files:
        if not file.endswith(('.py', '.js', '.jsx', '.json', '.html', '.css', '.md', '.sql', '.env', '.txt')):
            continue
        replace_in_file(os.path.join(root, file))
