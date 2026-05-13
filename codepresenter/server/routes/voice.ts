// Voice API Routes - Script generation and TTS for video narration
import { Router, Request, Response } from "express";
import { voiceService, VoiceOption, ScriptGenerationRequest } from "../services/voice-service";
import { normalizeTeachingProvider } from "../services/ai-providers";

const router = Router();

function getAiProviderOptions(body: any) {
  const rawProvider = typeof body?.aiProvider === "string" ? body.aiProvider : undefined;
  const rawModel = typeof body?.aiModel === "string" ? body.aiModel.trim() : undefined;
  return {
    aiProvider: rawProvider ? normalizeTeachingProvider(rawProvider) : undefined,
    aiModel: rawModel || undefined,
  };
}

/**
 * POST /api/voice/generate-script
 * Generate a narration script for notebook cells using Gemma 4.
 */
router.post("/generate-script", async (req: Request, res: Response) => {
  try {
    const { cells, context, style, duration } = req.body;

    if (!cells || !Array.isArray(cells) || cells.length === 0) {
      return res.status(400).json({ error: "cells array is required" });
    }

    const request: ScriptGenerationRequest = {
      cells,
      context,
      style: style || "educational",
      duration: duration || "long",
      ...getAiProviderOptions(req.body),
    };

    console.log(`[Voice API] Generating script for ${cells.length} cells...`);
    const script = await voiceService.generateScript(request);

    res.json({
      success: true,
      script: script.fullScript,
      segments: script.segments,
      totalDuration: script.totalDuration,
      provider: script.provider,
      model: script.model,
    });
  } catch (error: any) {
    console.error("[Voice API] Script generation error:", error);
    res.status(500).json({ error: error.message || "Script generation failed" });
  }
});

/**
 * POST /api/voice/generate-speech
 * Generate speech audio from text using GPT-4o-mini-tts
 */
router.post("/generate-speech", async (req: Request, res: Response) => {
  try {
    const { text, voice, instructions, format } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    console.log(`[Voice API] Generating speech (${text.length} chars)...`);
    const result = await voiceService.generateSpeech({
      text,
      voice: voice as VoiceOption,
      instructions,
      format: format || "mp3",
    });

    // Return audio as base64 for easy frontend consumption
    res.json({
      success: true,
      audio: result.audioBuffer.toString("base64"),
      format: result.format,
      mimeType: `audio/${result.format}`,
    });
  } catch (error: any) {
    console.error("[Voice API] Speech generation error:", error);
    res.status(500).json({ error: error.message || "Speech generation failed" });
  }
});

/**
 * POST /api/voice/generate-narration
 * Complete workflow: generate script + audio for notebook cells
 */
router.post("/generate-narration", async (req: Request, res: Response) => {
  try {
    const { cells, context, style, duration, voice, format } = req.body;

    if (!cells || !Array.isArray(cells) || cells.length === 0) {
      return res.status(400).json({ error: "cells array is required" });
    }

    const request: ScriptGenerationRequest = {
      cells,
      context,
      style: style || "educational",
      duration: duration || "long",
      ...getAiProviderOptions(req.body),
    };

    console.log(`[Voice API] Generating full narration for ${cells.length} cells...`);
    const result = await voiceService.generateNarrationAudio(
      request,
      (voice as VoiceOption) || "cedar",
      format || "mp3"
    );

    res.json({
      success: true,
      audioPath: result.audioPath,
      script: result.script.fullScript,
      segments: result.script.segments,
      totalDuration: result.script.totalDuration,
      audioDurationSeconds: result.audioDurationSeconds,
      provider: result.script.provider,
      model: result.script.model,
    });
  } catch (error: any) {
    console.error("[Voice API] Narration generation error:", error);
    res.status(500).json({ error: error.message || "Narration generation failed" });
  }
});

/**
 * POST /api/voice/generate-segments
 * Generate individual audio segments for each cell (for synced playback)
 */
router.post("/generate-segments", async (req: Request, res: Response) => {
  try {
    const { cells, context, style, duration, voice, format } = req.body;

    if (!cells || !Array.isArray(cells) || cells.length === 0) {
      return res.status(400).json({ error: "cells array is required" });
    }

    const request: ScriptGenerationRequest = {
      cells,
      context,
      style: style || "educational",
      duration: duration || "long",
      ...getAiProviderOptions(req.body),
    };

    console.log(`[Voice API] Generating script for segments...`);
    const script = await voiceService.generateScript(request);

    console.log(`[Voice API] Generating ${script.segments.length} audio segments...`);
    const audioSegments = await voiceService.generateSegmentAudio(
      script.segments,
      (voice as VoiceOption) || "cedar",
      format || "mp3"
    );

    // Combine script segments with audio paths
    const segments = script.segments.map((seg, index) => {
      const audio = audioSegments.find((a) => a.segmentIndex === index);
      return {
        cellIndex: seg.cellIndex,
        cellType: seg.cellType,
        script: seg.script,
        estimatedDuration: seg.estimatedDuration,
        audioPath: audio?.audioPath || null,
      };
    });

    res.json({
      success: true,
      segments,
      totalDuration: script.totalDuration,
      provider: script.provider,
      model: script.model,
    });
  } catch (error: any) {
    console.error("[Voice API] Segment generation error:", error);
    res.status(500).json({ error: error.message || "Segment generation failed" });
  }
});

/**
 * GET /api/voice/voices
 * List available voice options
 */
router.get("/voices", (_req: Request, res: Response) => {
  const voices = [
    { id: "none", name: "No AI voice", description: "Record a silent video without narration" },
    { id: "cedar", name: "Cedar", description: "Best quality, warm and clear" },
    { id: "marin", name: "Marin", description: "Best quality, confident and friendly" },
    { id: "alloy", name: "Alloy", description: "Neutral and balanced" },
    { id: "ash", name: "Ash", description: "Soft and measured" },
    { id: "ballad", name: "Ballad", description: "Expressive and dramatic" },
    { id: "coral", name: "Coral", description: "Warm and conversational" },
    { id: "rachel", name: "Rachel", description: "ElevenLabs voice" },
    { id: "adam", name: "Adam", description: "ElevenLabs voice" },
    { id: "antoni", name: "Antoni", description: "ElevenLabs voice" },
    { id: "bella", name: "Bella", description: "ElevenLabs voice" },
    { id: "josh", name: "Josh", description: "ElevenLabs voice" },
    { id: "elli", name: "Elli", description: "ElevenLabs voice" },
    { id: "haytham", name: "Haytham", description: "ElevenLabs voice" },
    { id: "marcotrox", name: "Marcotrox", description: "ElevenLabs voice" },
  ];

  res.json({ voices });
});

/**
 * GET /api/voice/provider
 * Show which teaching model provider is active for narration scripts.
 */
router.get("/provider", (_req: Request, res: Response) => {
  res.json(voiceService.getTeachingProviderStatus());
});

export default router;
