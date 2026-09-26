#!/usr/bin/env python3
"""Ferramenta do modpack: baixa mods do mods.lock.json, gera a documentação e
verifica atualizações no Modrinth.

  python3 tools/modpack.py download --side server --dest mods
  python3 tools/modpack.py download --side client --dest ~/.minecraft/mods
  python3 tools/modpack.py docs
  python3 tools/modpack.py check-updates

Só usa a biblioteca padrão do Python 3.8+.
"""
import argparse
import hashlib
import json
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'mods.lock.json'
USER_AGENT = 'lloupp/minecraft-mbot pz-server (github.com/lloupp/minecraft-mbot)'
SIDES = {'server': ('server', 'both'), 'client': ('client', 'both')}
SIDE_LABEL = {'both': 'ambos', 'server': 'servidor', 'client': 'cliente'}


def load_lock():
    return json.loads(LOCK.read_text(encoding='utf-8'))


def http_get(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def sha512(path):
    h = hashlib.sha512()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def download(side, dest):
    lock = load_lock()
    dest = Path(dest).expanduser()
    dest.mkdir(parents=True, exist_ok=True)
    wanted = [m for m in lock['mods'] if m['side'] in SIDES[side]]
    names = {m['file'] for m in wanted}

    # Jars que não estão no lock saem da pasta (movidos, nunca apagados).
    removed_dir = dest.parent / 'mods-removidos'
    for jar in dest.glob('*.jar'):
        if jar.name not in names:
            removed_dir.mkdir(exist_ok=True)
            shutil.move(str(jar), str(removed_dir / jar.name))
            print(f'  movido para {removed_dir.name}/: {jar.name}')

    failed = []
    for m in wanted:
        target = dest / m['file']
        if target.exists() and sha512(target) == m['sha512']:
            print(f'  ok        {m["file"]}')
            continue
        try:
            data = http_get(m['url'])
        except Exception as err:  # noqa: BLE001 - mostra qualquer falha de rede
            failed.append(f'{m["name"]}: {err}')
            continue
        if hashlib.sha512(data).hexdigest() != m['sha512']:
            failed.append(f'{m["name"]}: hash SHA-512 não confere (arquivo alterado na origem?)')
            continue
        tmp = target.with_suffix('.part')
        tmp.write_bytes(data)
        tmp.replace(target)
        print(f'  baixado   {m["file"]}')

    print(f'{len(wanted) - len(failed)}/{len(wanted)} mods ({side}) em {dest}')
    if failed:
        print('ERRO ao baixar:', *failed, sep='\n  ', file=sys.stderr)
        sys.exit(1)


def mod_row(m, by_slug):
    deps = ', '.join(by_slug[d]['name'] for d in m['depends_on']) or '—'
    if m.get('bundled'):
        deps = (deps + '; ' if deps != '—' else '') + ', '.join(m['bundled'])
    return (f'| [{m["name"]}]({m["page"]}) | `{m["version"]}` | {SIDE_LABEL[m["side"]]} '
            f'| {deps} | {m["reason"]} |')


def docs():
    lock = load_lock()
    mods = lock['mods']
    by_slug = {m['slug']: m for m in mods}
    header = ('| Mod | Versão | Lado | Dependências | Motivo |\n'
              '|---|---|---|---|---|')
    note = (f'Todos: Minecraft {lock["minecraft"]}, loader Forge ({lock["forge"]}), '
            f'baixados do Modrinth com SHA-512 conferido. '
            'Gerado por `python3 tools/modpack.py docs` a partir de `mods.lock.json`; '
            'não edite à mão.\n')

    def table(ms):
        return '\n'.join([header] + [mod_row(m, by_slug) for m in ms])

    counts = {s: sum(1 for m in mods if m['side'] == s) for s in ('both', 'server', 'client')}
    server = [m for m in mods if m['side'] in SIDES['server']]
    client = [m for m in mods if m['side'] in SIDES['client']]

    (ROOT / 'SERVER-MODS.md').write_text(
        f'# Mods do servidor ({len(server)})\n\n{note}\n'
        'Instalados por `install-server.sh` / `install-server.ps1` na pasta `mods/`.\n\n'
        f'{table(server)}\n', encoding='utf-8')

    (ROOT / 'CLIENT-MODS.md').write_text(
        f'# Mods do cliente ({len(client)})\n\n{note}\n'
        'Cada jogador instala estes jars na pasta `mods` do perfil Forge 1.20.1 '
        '(`install-client.ps1` / `install-client.sh` fazem isso). '
        f'Os {counts["server"]} mods só de servidor (Lost Cities, In Control, TACZ-Sound Attracts Zombies) '
        'não são necessários no cliente para entrar no servidor.\n\n'
        f'{table(client)}\n', encoding='utf-8')

    lines = [
        '# Mods\n', note,
        f'- Servidor: **{len(server)}** jars ({counts["both"]} em ambos + {counts["server"]} só servidor)',
        f'- Cliente: **{len(client)}** jars ({counts["both"]} em ambos + {counts["client"]} só cliente)',
        f'- Total no lock: **{len(mods)}**\n',
        '## Lista completa\n',
        '| Mod | Versão | Loader | Minecraft | Lado | Dependências | Link oficial | Motivo |',
        '|---|---|---|---|---|---|---|---|',
    ]
    for m in mods:
        deps = ', '.join(by_slug[d]['name'] for d in m['depends_on']) or '—'
        if m.get('bundled'):
            deps = (deps + '; ' if deps != '—' else '') + ', '.join(m['bundled'])
        lines.append(f'| {m["name"]} | `{m["version"]}` ({m["release_type"]}) | Forge | {lock["minecraft"]} '
                     f'| {SIDE_LABEL[m["side"]]} | {deps} | [Modrinth]({m["page"]}) | {m["reason"]} |')
    lines.append('')
    lines.append((ROOT / 'tools' / 'MODS-decisoes.md').read_text(encoding='utf-8'))
    (ROOT / 'MODS.md').write_text('\n'.join(lines), encoding='utf-8')
    print('MODS.md, SERVER-MODS.md e CLIENT-MODS.md gerados.')


def check_updates():
    lock = load_lock()
    query = urllib.parse.urlencode({'game_versions': json.dumps([lock['minecraft']]),
                                    'loaders': json.dumps(['forge'])})
    for m in lock['mods']:
        try:
            versions = json.loads(http_get(f'https://api.modrinth.com/v2/project/{m["slug"]}/version?{query}'))
        except Exception as err:  # noqa: BLE001
            print(f'  ?  {m["name"]}: {err}')
            continue
        releases = [v for v in versions if v['version_type'] == 'release'] or versions
        latest = releases[0]['version_number'] if releases else None
        mark = '  ' if latest == m['version'] else '->'
        print(f'{mark} {m["name"]:34} lock {m["version"]:32} Modrinth {latest}')
    print('Para atualizar: edite url/sha512/file/version no lock, rode `docs` e teste o servidor.')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    d = sub.add_parser('download')
    d.add_argument('--side', choices=SIDES, required=True)
    d.add_argument('--dest', required=True)
    sub.add_parser('docs')
    sub.add_parser('check-updates')
    args = parser.parse_args()
    if args.cmd == 'download':
        download(args.side, args.dest)
    elif args.cmd == 'docs':
        docs()
    else:
        check_updates()


if __name__ == '__main__':
    main()
