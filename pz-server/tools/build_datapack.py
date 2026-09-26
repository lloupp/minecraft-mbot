#!/usr/bin/env python3
"""Gera o datapack global `moonlight-global-datapacks/pz-survival`.

O Moonlight (dependência do Supplementaries) carrega essa pasta em todos os
mundos, então o datapack vale desde a criação do mundo sem mexer em world/.

  python3 tools/build_datapack.py

Conteúdo:
- loot por tipo de prédio do Lost Cities (conditions/chestloot.json + tabelas pz:chests/*);
- spawners dos prédios do Lost Cities só com zumbis;
- TaCZ: bancadas de armas e de munição sem receita: armas e munição só no loot
  (a de acessórios continua). O gun pack do TaCZ carrega depois dos datapacks, então
  não dá para só encarecer as receitas de munição; desativar a bancada funciona.
"""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'moonlight-global-datapacks' / 'pz-survival'


# ---------- helpers de loot table ----------
def item(name, weight, count=None, nbt=None):
    entry = {'type': 'minecraft:item', 'name': name, 'weight': weight}
    functions = []
    if count:
        lo, hi = count if isinstance(count, tuple) else (count, count)
        functions.append({'function': 'minecraft:set_count',
                          'count': lo if lo == hi else {'type': 'minecraft:uniform', 'min': lo, 'max': hi}})
    if nbt:
        functions.append({'function': 'minecraft:set_nbt', 'tag': nbt})
    if functions:
        entry['functions'] = functions
    return entry


def empty(weight):
    return {'type': 'minecraft:empty', 'weight': weight}


def damaged(entry, lo=0.2, hi=0.7):
    entry.setdefault('functions', []).append(
        {'function': 'minecraft:set_damage', 'damage': {'type': 'minecraft:uniform', 'min': lo, 'max': hi}})
    return entry


def gun(gun_id, weight, mode='SEMI'):
    return item('tacz:modern_kinetic_gun', weight,
                nbt=f'{{GunId:"tacz:{gun_id}",GunFireMode:"{mode}",GunCurrentAmmoCount:0,HasBulletInBarrel:0b}}')


def ammo(ammo_id, weight, count):
    return item('tacz:ammo', weight, count, nbt=f'{{AmmoId:"tacz:{ammo_id}"}}')


def attachment(att_id, weight):
    return item('tacz:attachment', weight, nbt=f'{{AttachmentId:"tacz:{att_id}"}}')


def pool(rolls, entries):
    lo, hi = rolls
    return {'rolls': lo if lo == hi else {'type': 'minecraft:uniform', 'min': lo, 'max': hi}, 'entries': entries}


def table(*pools):
    return {'type': 'minecraft:chest', 'pools': list(pools)}


# ---------- itens por categoria ----------
FOOD_COMMON = [
    item('minecraft:bread', 6, (1, 2)), item('minecraft:potato', 6, (1, 3)), item('minecraft:carrot', 5, (1, 3)),
    item('minecraft:apple', 4, (1, 2)), item('minecraft:beetroot', 3, (1, 3)), item('minecraft:dried_kelp', 3, (2, 5)),
    item('farmersdelight:cabbage', 3, 1), item('farmersdelight:tomato', 3, (1, 2)), item('farmersdelight:onion', 3, (1, 2)),
    item('minecraft:sweet_berries', 2, (2, 4)), item('minecraft:honey_bottle', 1),
]
FOOD_COOKED = [
    item('minecraft:cooked_beef', 2), item('minecraft:cooked_porkchop', 2), item('minecraft:cooked_chicken', 3),
    item('minecraft:baked_potato', 4, (1, 2)), item('minecraft:mushroom_stew', 2), item('minecraft:pumpkin_pie', 1),
    item('farmersdelight:rice', 2, (1, 3)), item('farmersdelight:beef_stew', 1), item('farmersdelight:vegetable_soup', 1),
]
SEEDS = [
    item('minecraft:wheat_seeds', 3, (2, 6)), item('minecraft:beetroot_seeds', 2, (2, 4)),
    item('farmersdelight:cabbage_seeds', 2, (1, 3)), item('farmersdelight:tomato_seeds', 2, (1, 3)),
]
MEDICAL_COMMON = [item('firstaid:bandage', 6, (1, 2)), item('firstaid:plaster', 5, (1, 3))]
MEDICAL_RARE = [item('firstaid:morphine', 2), item('minecraft:golden_apple', 1)]  # maçã dourada cura a infecção
HOUSEHOLD = [
    item('minecraft:torch', 5, (2, 6)), item('minecraft:string', 4, (1, 4)), item('minecraft:paper', 4, (1, 5)),
    item('minecraft:stick', 4, (2, 6)), item('minecraft:leather', 2, (1, 2)), item('minecraft:white_wool', 2, (1, 3)),
    item('minecraft:bowl', 2, (1, 2)), item('minecraft:glass_bottle', 2, (1, 2)), item('minecraft:book', 1),
    item('minecraft:candle', 2, (1, 2)), item('minecraft:feather', 2, (1, 4)), item('cold_sweat:waterskin', 1),
]
CLOTHES = [
    damaged(item('minecraft:leather_helmet', 3)), damaged(item('minecraft:leather_chestplate', 2)),
    damaged(item('minecraft:leather_leggings', 2)), damaged(item('minecraft:leather_boots', 3)),
    item('cold_sweat:goat_fur', 1, (1, 2)),
]
TOOLS_BASIC = [
    damaged(item('minecraft:wooden_axe', 3)), damaged(item('minecraft:stone_axe', 3)),
    damaged(item('minecraft:stone_pickaxe', 3)), damaged(item('minecraft:stone_shovel', 2)),
    damaged(item('minecraft:wooden_sword', 2)), damaged(item('minecraft:stone_sword', 2)),
]
TOOLS_WORKSHOP = TOOLS_BASIC + [
    damaged(item('minecraft:iron_axe', 2)), damaged(item('minecraft:iron_pickaxe', 1)),
    damaged(item('minecraft:iron_shovel', 1)), item('minecraft:shears', 2), item('minecraft:flint_and_steel', 1),
    item('minecraft:bucket', 2), item('minecraft:shield', 1),
]
MATERIALS = [
    item('minecraft:iron_nugget', 5, (2, 8)), item('minecraft:iron_ingot', 2, (1, 2)),
    item('minecraft:copper_ingot', 3, (1, 3)), item('minecraft:coal', 5, (1, 4)), item('minecraft:flint', 3, (1, 3)),
    item('minecraft:redstone', 2, (1, 4)), item('minecraft:gunpowder', 1, (1, 2)), item('minecraft:oak_planks', 3, (2, 8)),
    item('minecraft:cobblestone', 3, (4, 12)), item('minecraft:glass', 2, (1, 4)),
]
BACKPACK_RARE = [item('sophisticatedbackpacks:backpack', 3)]
PISTOLS = [gun('glock_17', 4), gun('m1911', 3), gun('cz75', 2), gun('p320', 2), gun('m9a4', 2)]
SHOTGUNS = [gun('db_short', 3), gun('m870', 2)]
SMGS = [gun('ump45', 2, 'AUTO'), gun('hk_mp5a5', 2, 'AUTO'), gun('uzi', 2, 'AUTO')]
RIFLES = [gun('ak47', 2), gun('m4a1', 2), gun('sks_tactical', 2), gun('kar98', 2), gun('m700', 1)]
PISTOL_AMMO = [ammo('9mm', 6, (3, 10)), ammo('45acp', 4, (3, 8))]
SHOTGUN_AMMO = [ammo('12g', 5, (2, 6))]
RIFLE_AMMO = [ammo('556x45', 3, (3, 10)), ammo('762x39', 3, (3, 10)), ammo('308', 2, (2, 6)), ammo('30_06', 1, (2, 5))]
ATTACHMENTS = [attachment('sight_rmr_dot', 2), attachment('grip_vertical_military', 2),
               attachment('extended_mag_1', 2), attachment('muzzle_silencer_mirage', 1), attachment('laser_compact', 1)]


TABLES = {
    # Casas/apartamentos: loot doméstico; armas quase nunca.
    'domestic': table(
        pool((1, 3), [empty(12)] + FOOD_COMMON + HOUSEHOLD + CLOTHES),
        pool((0, 1), [empty(30)] + MEDICAL_COMMON + TOOLS_BASIC + BACKPACK_RARE +
             [item('minecraft:golden_apple', 1)]),
        pool((1, 1), [empty(300), gun('glock_17', 1), ammo('9mm', 2, (2, 6))]),
    ),
    # Mercados: comida é o valor principal.
    'market': table(
        pool((2, 4), [empty(6)] + FOOD_COMMON + FOOD_COOKED + SEEDS),
        pool((0, 1), [empty(20)] + HOUSEHOLD + [item('cold_sweat:waterskin', 2), item('minecraft:salmon', 1, (1, 2))]),
    ),
    'restaurant': table(
        pool((2, 3), [empty(5)] + FOOD_COOKED + FOOD_COMMON),
        pool((0, 1), [empty(10), item('minecraft:bowl', 3, (1, 4)), item('farmersdelight:flint_knife', 1),
                      item('farmersdelight:cooking_pot', 1), item('minecraft:sugar', 2, (1, 3))]),
    ),
    # Farmácia/clínica: medicamentos relativamente raros.
    'pharmacy': table(
        pool((1, 2), [empty(10)] + MEDICAL_COMMON + [item('minecraft:glass_bottle', 3, (1, 3)),
                                                     item('minecraft:sugar', 2, (1, 2))]),
        pool((0, 1), [empty(25)] + MEDICAL_RARE),
    ),
    # Oficinas (posto de gasolina, porões): ferramentas e materiais.
    'workshop': table(
        pool((1, 3), [empty(8)] + MATERIALS),
        pool((0, 1), [empty(10)] + TOOLS_WORKSHOP),
        pool((0, 1), [empty(60), item('tacz:ammo_box', 1)] + BACKPACK_RARE),
    ),
    # Escritórios/biblioteca/prefeitura: pouco de útil, às vezes pistola.
    'office': table(
        pool((1, 2), [empty(10), item('minecraft:paper', 5, (2, 8)), item('minecraft:book', 3, (1, 2)),
                      item('minecraft:compass', 1), item('minecraft:clock', 1), item('minecraft:map', 1),
                      item('minecraft:ink_sac', 2, (1, 2))] + MEDICAL_COMMON),
        pool((1, 1), [empty(120)] + PISTOLS + PISTOL_AMMO),
    ),
    # Militar/polícia (torre de rádio, dungeons do metrô): onde estão as armas.
    'military': table(
        pool((1, 2), [empty(6)] + PISTOL_AMMO + SHOTGUN_AMMO + RIFLE_AMMO + MEDICAL_COMMON),
        pool((1, 1), [empty(50)] + PISTOLS + SHOTGUNS + SMGS + RIFLES),
        pool((0, 1), [empty(12)] + ATTACHMENTS + [
            damaged(item('minecraft:iron_helmet', 2)), damaged(item('minecraft:iron_chestplate', 1)),
            damaged(item('minecraft:chainmail_chestplate', 2)), item('sophisticatedbackpacks:iron_backpack', 1)]),
    ),
}

# Qual tabela cada prédio do Lost Cities usa. `factor` é o peso entre as regras que casam.
SHOPPING = ['shopping00', 'shopping01', 'shopping10', 'shopping11',
            'shopping_open00', 'shopping_open01', 'shopping_open10', 'shopping_open11']
OFFICES = ['library00', 'library01', 'library10', 'library11', 'center00', 'center01', 'center10', 'center11',
           'town00', 'town01', 'town10', 'town11']
HOUSES = [f'building{i}' for i in range(1, 9)] + ['cabin']
CHESTLOOT = [
    {'factor': 1, 'value': 'pz:chests/domestic'},
    {'factor': 20, 'value': 'pz:chests/domestic', 'inbuilding': HOUSES},
    {'factor': 2, 'value': 'pz:chests/pharmacy', 'inbuilding': HOUSES},
    {'factor': 1, 'value': 'pz:chests/workshop', 'inbuilding': HOUSES},
    {'factor': 20, 'value': 'pz:chests/market', 'inbuilding': SHOPPING},
    {'factor': 8, 'value': 'pz:chests/pharmacy', 'inbuilding': SHOPPING},
    {'factor': 20, 'value': 'pz:chests/restaurant', 'inbuilding': ['highway_restaurant', 'highway_restaurant_parking']},
    {'factor': 5, 'value': 'pz:chests/market', 'inbuilding': ['highway_restaurant', 'highway_restaurant_parking']},
    {'factor': 20, 'value': 'pz:chests/workshop', 'inbuilding': ['highway_gas_station']},
    {'factor': 4, 'value': 'pz:chests/market', 'inbuilding': ['highway_gas_station']},
    {'factor': 16, 'value': 'pz:chests/office', 'inbuilding': OFFICES},
    {'factor': 8, 'value': 'pz:chests/pharmacy', 'inbuilding': OFFICES},
    {'factor': 1, 'value': 'pz:chests/military', 'inbuilding': OFFICES},
    {'factor': 20, 'value': 'pz:chests/military', 'inbuilding': ['radiotower']},
    {'factor': 16, 'value': 'pz:chests/workshop', 'inbuilding': ['oilrig00', 'oilrig01', 'oilrig10', 'oilrig11']},
    {'factor': 4, 'value': 'pz:chests/military', 'inbuilding': ['oilrig00', 'oilrig01', 'oilrig10', 'oilrig11']},
    {'factor': 10, 'value': 'pz:chests/workshop', 'cellar': True},
    {'factor': 30, 'value': 'pz:chests/military', 'inpart': 'rail_dungeon1'},
    {'factor': 30, 'value': 'pz:chests/military', 'inpart': 'rail_dungeon2'},
]
SPAWNER_MOBS = [
    {'factor': 6, 'value': 'minecraft:zombie'},
    {'factor': 2, 'value': 'minecraft:zombie_villager'},
    {'factor': 2, 'value': 'minecraft:husk'},
]

DISABLED = {'type': 'minecraft:crafting_shapeless', 'conditions': [{'type': 'forge:false'}],
            'ingredients': [{'item': 'minecraft:barrier'}], 'result': {'item': 'minecraft:barrier'}}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main():
    argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()
    if OUT.exists():
        shutil.rmtree(OUT)
    write(OUT / 'pack.mcmeta', {'pack': {'pack_format': 15, 'description': 'pz-server: loot, spawners e balanceamento'}})
    for name, data in TABLES.items():
        write(OUT / 'data' / 'pz' / 'loot_tables' / 'chests' / f'{name}.json', data)
    # Tabelas originais do Lost Cities (diamantes/esmeraldas) viram as do servidor.
    write(OUT / 'data/lostcities/loot_tables/chests/lostcitychest.json', TABLES['domestic'])
    write(OUT / 'data/lostcities/loot_tables/chests/raildungeonchest.json', TABLES['military'])
    write(OUT / 'data/lostcities/lostcities/conditions/chestloot.json', {'values': CHESTLOOT})
    for name in ('easymobs', 'hardmobs'):
        write(OUT / 'data/lostcities/lostcities/conditions' / f'{name}.json', {'values': SPAWNER_MOBS})
    for recipe in ('gun_smith_table', 'ammo_workbench'):
        write(OUT / 'data/tacz/recipes' / f'{recipe}.json', DISABLED)
    print(f'Datapack gerado em {OUT.relative_to(ROOT)} ({len(TABLES)} tabelas de loot).')


if __name__ == '__main__':
    main()
