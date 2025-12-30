import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension, RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { CommentAppearance, CommentStyle, Settings } from '../settings';
import { buildStyleString, escapeRegex } from '../utility';
import {
	appearanceSettingsField,
	commentStyleField,
	customCommentTokensField,
	CustomCommentTokens,
	enableAppearanceField,
	setAppearanceSettings,
	setCommentStyle,
	setCustomCommentTokens,
	setEnableAppearance,
} from './fields';

export class CommentViewPlugin implements PluginValue {
	private decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = this.buildDecorations(view);
	}

	/**
	 * Create the extension for the plugin, with all its required fields.
	 */
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

	/**
	 * Update the appearance settings for the plugin in the given view.
	 */
	public static updateAppearance(view: EditorView, appearance: CommentAppearance) {
		view.dispatch({
			effects: [setAppearanceSettings.of(appearance)],
		});
	}

	/**
	 * Update the enabled state for the plugin in the given view.
	 */
	public static updateEnabled(view: EditorView, enabled: boolean) {
		view.dispatch({
			effects: [setEnableAppearance.of(enabled)],
		});
	}

	/**
	 * Update the comment settings for the plugin in the given view.
	 */
	public static updateCommentSettings(
		view: EditorView,
		commentStyle: CommentStyle,
		customStart: string,
		customEnd: string,
	) {
		view.dispatch({
			effects: [
				setCommentStyle.of(commentStyle),
				setCustomCommentTokens.of({ start: customStart, end: customEnd }),
			],
		});
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) {
			this.decorations = this.buildDecorations(update.view);
			return;
		}

		for (const effect of update.transactions.flatMap((trn) => trn.effects)) {
			if (
				effect.is(setAppearanceSettings) ||
				effect.is(setEnableAppearance) ||
				effect.is(setCommentStyle) ||
				effect.is(setCustomCommentTokens)
			) {
				this.decorations = this.buildDecorations(update.view);
				return;
			}
		}
	}

	destroy() {}

	buildDecorations(view: EditorView): DecorationSet {
		if (!view.state.field(enableAppearanceField)) {
			return this.emptyDecorationSet;
		}

		const appearance = view.state.field(appearanceSettingsField);
		const style = buildStyleString(appearance);
		const commentStyle = view.state.field(commentStyleField);
		const customTokens = view.state.field(customCommentTokensField);

		// Collect all decoration ranges (syntax tree + custom regex)
		const ranges: { from: number; to: number }[] = [];

		for (const { from, to } of view.visibleRanges) {
			// Always check syntax tree for standard comments (HTML, Obsidian, code block comments)
			syntaxTree(view.state).iterate({
				from,
				to,
				enter: (node) => {
					if (node.type.name !== 'comment') {
						return;
					}
					ranges.push({ from: node.from, to: node.to });
				},
			});

			// For custom comments, also use regex-based matching
			if (commentStyle === 'custom' && customTokens.start && customTokens.end) {
				this.findCustomCommentRanges(view, from, to, customTokens, ranges);
			}
		}

		// Sort ranges by position (required by RangeSetBuilder)
		ranges.sort((a, b) => a.from - b.from || a.to - b.to);

		// Remove duplicates and overlapping ranges
		const uniqueRanges = this.deduplicateRanges(ranges);

		// Build decorations
		const builder = new RangeSetBuilder<Decoration>();
		const decoration = Decoration.mark({ attributes: { style } });

		for (const { from, to } of uniqueRanges) {
			builder.add(from, to, decoration);
		}

		return builder.finish();
	}

	/**
	 * Find custom comment ranges using regex pattern matching.
	 */
	private findCustomCommentRanges(
		view: EditorView,
		from: number,
		to: number,
		tokens: CustomCommentTokens,
		ranges: { from: number; to: number }[],
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
			ranges.push({ from: matchFrom, to: matchTo });
		}
	}

	/**
	 * Remove duplicate and overlapping ranges, keeping the largest range when overlapping.
	 */
	private deduplicateRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[] {
		if (ranges.length === 0) {
			return [];
		}

		const result: { from: number; to: number }[] = [];
		let current = ranges[0];

		for (let i = 1; i < ranges.length; i++) {
			const next = ranges[i];

			// Check if ranges overlap or are adjacent
			if (next.from <= current.to) {
				// Merge overlapping ranges
				current = { from: current.from, to: Math.max(current.to, next.to) };
			} else {
				result.push(current);
				current = next;
			}
		}

		result.push(current);
		return result;
	}

	private get emptyDecorationSet(): DecorationSet {
		return new RangeSetBuilder<Decoration>().finish();
	}
}
