import { SampleRecognitionService, type RecognizedPage } from "../../core/sample-recognition-service";
import { buildSegmentationReviewModel } from "../../core/sample-segmentation-review";
import { openSegmentationReviewDialog } from "./segmentation-review-dialog";

/**
 * UI-only decorator for the production recognition service.
 *
 * Automatic OCR and segmentation still run in the shared Recognition/Foundation
 * path. Only pages explicitly marked as segmentation-review candidates are paused
 * for human geometry correction before the existing setup flow receives samples.
 */
export class SegmentationReviewRecognitionService extends SampleRecognitionService {
  constructor(
    private readonly delegate: SampleRecognitionService,
    private readonly root: HTMLElement
  ) {
    super();
  }

  override async warmup(): Promise<{ engine: string; ready: boolean; message: string }> {
    return this.delegate.warmup();
  }

  override async recognizePage(file: File, index = 0): Promise<RecognizedPage> {
    const page = await this.delegate.recognizePage(file, index);
    if (!page.requiresSegmentationReview) return page;
    if (!buildSegmentationReviewModel(page)) return page;
    return openSegmentationReviewDialog({ root: this.root, page });
  }
}
