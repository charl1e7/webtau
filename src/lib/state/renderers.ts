import { RendererRegistry } from '#lib/render/registry';
import { createWorldRenderer } from '#lib/render/world';
import { getEngine } from './engine';

/**
 * The renderer backends of the app. Another backend is added by registering it
 * here (or from a plugin), next to the classic UTAU one.
 */
export const renderers = new RendererRegistry().register(createWorldRenderer(getEngine));
