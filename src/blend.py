import json
import os
import re
import sys

import bpy

VARIANT_SUFFIX = re.compile(r'^(.*)_(\d+)$')

args = sys.argv[sys.argv.index('--') + 1:]
manifest_path = args[0]


def images_pack():
    for image in bpy.data.images:
        if image.packed_file is not None:
            continue

        if not image.filepath:
            continue

        try:
            image.pack()
        except RuntimeError:
            continue


def geometry_share():
    meshes = {mesh.name: mesh for mesh in bpy.data.meshes}
    shared = 0

    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue

        match = VARIANT_SUFFIX.match(obj.data.name)

        if match is None:
            continue

        base = meshes.get(match.group(1))

        if base is None or base is obj.data:
            continue

        if len(base.vertices) != len(obj.data.vertices):
            continue

        material = None

        if len(obj.material_slots) != 0:
            material = obj.material_slots[0].material

        obj.data = base

        if len(obj.material_slots) != 0:
            obj.material_slots[0].link = 'OBJECT'
            obj.material_slots[0].material = material

        obj['wow_display_id'] = int(match.group(2))
        shared += 1

    return shared


def variants_isolate():
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue

        display_id = obj.get('wow_display_id')

        if display_id is None:
            continue

        name = 'variant_' + str(display_id)
        collection = bpy.data.collections.get(name)

        if collection is None:
            collection = bpy.data.collections.new(name)
            bpy.context.scene.collection.children.link(collection)

        for parent in list(obj.users_collection):
            parent.objects.unlink(obj)

        collection.objects.link(obj)

        obj.hide_viewport = True
        obj.hide_render = True


def orphans_purge():
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def asset_convert(glb_path, blend_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    geometry_share()
    variants_isolate()
    images_pack()
    orphans_purge()

    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)


with open(manifest_path, 'r') as handle:
    entries = json.load(handle)

done = 0
failed = 0

for entry in entries:
    try:
        asset_convert(entry['glb'], entry['blend'])
        done += 1
    except Exception as error:
        failed += 1
        print('BATCH_FAIL ' + entry['glb'] + ' :: ' + str(error))

print('BATCH_DONE ' + str(done) + ' ' + str(failed))
