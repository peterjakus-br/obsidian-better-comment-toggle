# Plan: Fix CriticMarkup Custom Syntax Highlighting

## Problem Analysis

When using CriticMarkup comment syntax (e.g., `{>> comment <<}`) as a custom comment style:
- ✅ **Comment insertion works** - The plugin correctly wraps text with the custom tokens
- ❌ **Highlighting does NOT work** - Custom syntax comments are not styled

### Root Cause

The highlighting logic in `src/extensions/plugin.ts:77` relies entirely on CodeMirror's syntax tree:

```typescript
syntaxTree(view.state).iterate({
    // ...
    enter: (node) => {
        if (node.type.name !== 'comment') {  // <-- Only matches CodeMirror's 'comment' nodes
            return;
        }
        // Apply decoration
    }
});
```

CodeMirror's Markdown parser only recognizes standard comment syntaxes as `comment` nodes:
- HTML: `<!-- -->`
- Obsidian: `%% %%`
- Language-specific (in code blocks): `//`, `#`, `/* */`, etc.

**CriticMarkup syntax like `{>> comment <<}` is NOT recognized** - it's treated as regular text by CodeMirror.

---

## Solution Overview

Add regex-based pattern matching for custom comment syntax to supplement the syntax tree detection.

### Key Changes

1. **Add state fields for comment settings** (`src/extensions/fields.ts`)
   - Add `commentStyleField` to store the current comment style (html/obsidian/custom)
   - Add `customCommentTokensField` to store the custom start/end tokens

2. **Modify the view plugin** (`src/extensions/plugin.ts`)
   - Pass comment settings when creating the extension
   - In `buildDecorations()`:
     - Keep syntax tree detection for standard comments (html, obsidian)
     - Add regex-based matching when `commentStyle === 'custom'`
   - Build a regex pattern from the custom tokens to find matches in the document text

3. **Update main plugin** (`src/main.ts`)
   - Pass comment style and custom tokens to `CommentViewPlugin.createExtension()`
   - Add method to refresh comment settings when they change

4. **Update settings tab** (`src/settings/tab.ts`)
   - Call refresh method when comment style or custom tokens change

---

## Implementation Details

### Step 1: Extend State Fields (`fields.ts`)

```typescript
// Add new state effect and field for comment style
export const setCommentStyle = StateEffect.define<CommentStyle>();
export const commentStyleField = StateField.define<CommentStyle>({
    create: () => 'html',
    update: (value, transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(setCommentStyle)) {
                return effect.value;
            }
        }
        return value;
    }
});

// Add state effect and field for custom comment tokens
export interface CustomCommentTokens {
    start: string;
    end: string;
}

export const setCustomCommentTokens = StateEffect.define<CustomCommentTokens>();
export const customCommentTokensField = StateField.define<CustomCommentTokens>({
    create: () => ({ start: '<!--', end: '-->' }),
    update: (value, transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(setCustomCommentTokens)) {
                return effect.value;
            }
        }
        return value;
    }
});
```

### Step 2: Modify View Plugin (`plugin.ts`)

```typescript
buildDecorations(view: EditorView): DecorationSet {
    if (!view.state.field(enableAppearanceField)) {
        return this.emptyDecorationSet;
    }

    const builder = new RangeSetBuilder<Decoration>();
    const appearance = view.state.field(appearanceSettingsField);
    const style = buildStyleString(appearance);
    const commentStyle = view.state.field(commentStyleField);
    const customTokens = view.state.field(customCommentTokensField);

    for (const { from, to } of view.visibleRanges) {
        // For custom comments, use regex-based matching
        if (commentStyle === 'custom' && customTokens.start && customTokens.end) {
            this.addCustomCommentDecorations(view, builder, from, to, customTokens, style);
        }

        // Always also check syntax tree for standard comments (HTML, Obsidian, code block comments)
        syntaxTree(view.state).iterate({
            from,
            to,
            enter: (node) => {
                if (node.type.name !== 'comment') {
                    return;
                }
                builder.add(
                    node.from,
                    node.to,
                    Decoration.mark({ attributes: { style } })
                );
            },
        });
    }

    return builder.finish();
}

private addCustomCommentDecorations(
    view: EditorView,
    builder: RangeSetBuilder<Decoration>,
    from: number,
    to: number,
    tokens: CustomCommentTokens,
    style: string
) {
    const text = view.state.doc.sliceString(from, to);
    const startEscaped = escapeRegex(tokens.start);
    const endEscaped = escapeRegex(tokens.end);

    // Pattern: startToken + any content (non-greedy) + endToken
    const pattern = new RegExp(`${startEscaped}[\\s\\S]*?${endEscaped}`, 'g');

    let match;
    while ((match = pattern.exec(text)) !== null) {
        const matchFrom = from + match.index;
        const matchTo = matchFrom + match[0].length;

        builder.add(
            matchFrom,
            matchTo,
            Decoration.mark({ attributes: { style } })
        );
    }
}
```

### Step 3: Update Extension Creation (`plugin.ts`)

```typescript
public static createExtension(settings: Settings): Extension {
    return [
        enableAppearanceField.init(() => settings.overrideAppearance),
        appearanceSettingsField.init(() => settings.appearance),
        commentStyleField.init(() => settings.commentStyle),
        customCommentTokensField.init(() => ({
            start: settings.customCommentStart,
            end: settings.customCommentEnd,
        })),
        ViewPlugin.fromClass(CommentViewPlugin, {
            decorations: (value) => value.decorations,
        }),
    ];
}

public static updateCommentSettings(
    view: EditorView,
    commentStyle: CommentStyle,
    customStart: string,
    customEnd: string
) {
    view.dispatch({
        effects: [
            setCommentStyle.of(commentStyle),
            setCustomCommentTokens.of({ start: customStart, end: customEnd }),
        ],
    });
}
```

### Step 4: Update Main Plugin (`main.ts`)

```typescript
public refreshCommentSettings() {
    const editorView = this.activeEditorView;
    if (!editorView) {
        return;
    }

    CommentViewPlugin.updateCommentSettings(
        editorView,
        this.settings.commentStyle,
        this.settings.customCommentStart,
        this.settings.customCommentEnd
    );
}
```

### Step 5: Update Settings Tab (`tab.ts`)

Call `this.plugin.refreshCommentSettings()` when:
- Comment style changes (html/obsidian/custom radio buttons)
- Custom comment start token changes
- Custom comment end token changes

---

## Edge Cases to Handle

1. **Overlapping decorations**: When both syntax tree and regex match the same range (e.g., if someone sets custom tokens to `<!-- -->`), avoid duplicate decorations

2. **RangeSetBuilder ordering**: Decorations must be added in document order; may need to collect all ranges first, sort them, then add to builder

3. **Empty tokens**: Skip regex matching if start or end token is empty

4. **Performance**: For very long documents, consider limiting regex search scope or using incremental updates

---

## Testing Scenarios

1. **CriticMarkup Comments**: `{>> This is a comment <<}` - should highlight
2. **Standard HTML**: `<!-- comment -->` - should still work
3. **Obsidian Style**: `%% comment %%` - should still work
4. **Code Block Comments**: Comments in code blocks should still work
5. **Mixed Content**: Document with both standard and custom comments
6. **Multi-line**: Custom comments spanning multiple lines
7. **Settings Change**: Switching between comment styles should update highlighting immediately

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/extensions/fields.ts` | Add `commentStyleField`, `customCommentTokensField`, and their effects |
| `src/extensions/plugin.ts` | Add regex-based matching for custom comments |
| `src/main.ts` | Add `refreshCommentSettings()` method |
| `src/settings/tab.ts` | Call refresh when comment settings change |
| `src/utility/generalUtils.ts` | Import `escapeRegex` in plugin.ts (already exists) |
