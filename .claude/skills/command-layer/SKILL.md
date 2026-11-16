---
name: command-layer
description: Adding or changing a project command (setMachine, addPart, runNesting, ...). Spec §5.1. Use whenever project JSON is mutated.
---

# Command layer (spec §5.1)

Everything that changes project data is a command. UI buttons, the cut-list table, DXF import and AI all call the same commands.

## Each command has four parts
1. **Schema**: Zod schema of params (types, bounds, units in mm).
2. **Apply**: a pure function `(project, params) => project` with no side effects (Immer `produceWithPatches`).
3. **Undo**: store the patches and inverse patches; undo/redo replays them.
4. **Log**: who (user | ai), when, which command → `project_commands`.

After every command the rule validation runs and the warning list is refreshed.

## Adding a command: checklist
- [ ] Zod schema in `packages/core/commands/<area>/<name>.ts`
- [ ] pure apply, registered in the command registry
- [ ] unit test: apply → expected JSON
- [ ] property test: **apply then undo restores the project byte for byte**
- [ ] validation rules triggered by it covered
- [ ] the schema is exported as an AI tool definition (zod → JSON schema). Export and machine-profile changes are **never** AI tools.
- [ ] UI binding uses the command, never mutates state directly

Initial set: setMachine, setMaterial, setThickness, setSheetSize, setGrain · addPart, updatePart, removePart, duplicatePart, importCutList, importDxf · addSegment, setSegmentLength, setSegmentBulge, moveVertex, filletCorners, addDogbone, convertToFreeform · addHole, updateHole, removeHole, setOperation · addTemplate, updateTemplateInstance, saveAsTemplate · setNestingMode, setNestingOptions, runNesting, lockPlacement.
