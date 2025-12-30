import { StateEffect, StateField } from '@codemirror/state';
import { CommentAppearance, CommentStyle, DEFAULT_SETTINGS } from '../settings';

export interface CustomCommentTokens {
	start: string;
	end: string;
}

export const setEnableAppearance = StateEffect.define<boolean>();
export const enableAppearanceField = StateField.define({
	create: () => false,
	update: (value, transaction) => {
		for (const effect of transaction.effects) {
			if (effect.is(setEnableAppearance)) {
				return effect.value;
			}
		}

		return value;
	},
});

export const setAppearanceSettings = StateEffect.define<Partial<CommentAppearance>>();
export const appearanceSettingsField = StateField.define<CommentAppearance>({
	create: () => ({ ...DEFAULT_SETTINGS.appearance }),
	update: (value, transaction) => {
		for (const effect of transaction.effects) {
			if (effect.is(setAppearanceSettings)) {
				value = {
					...value,
					...effect.value,
				};
			}
		}

		return value;
	},
});

export const setCommentStyle = StateEffect.define<CommentStyle>();
export const commentStyleField = StateField.define<CommentStyle>({
	create: () => DEFAULT_SETTINGS.commentStyle,
	update: (value, transaction) => {
		for (const effect of transaction.effects) {
			if (effect.is(setCommentStyle)) {
				return effect.value;
			}
		}

		return value;
	},
});

export const setCustomCommentTokens = StateEffect.define<CustomCommentTokens>();
export const customCommentTokensField = StateField.define<CustomCommentTokens>({
	create: () => ({
		start: DEFAULT_SETTINGS.customCommentStart,
		end: DEFAULT_SETTINGS.customCommentEnd,
	}),
	update: (value, transaction) => {
		for (const effect of transaction.effects) {
			if (effect.is(setCustomCommentTokens)) {
				return effect.value;
			}
		}

		return value;
	},
});
