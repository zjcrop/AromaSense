import { SampleRecognitionService, type RecognizedPage } from "../../core/sample-recognition-service";
import { buildSegmentationReviewModel } from "../../core/sample-segmentation-review";
import { openSegmentationReviewDialogV2 } from "./segmentation-review-dialog-v2";

/**
 * UI-only decorator for the production recognition service.
 *
 * First-pass OCR is only evidence for locating candidate regions. When a page is
 * marked for segmentation review, the v2 review flow keeps the untouched File as
 * the source of truth, lets the user correct geometry on a Worker-generated small
 * preview, then re-runs every accepted region against the original image pixels.
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
    return openSegmentationReviewDialogV2({
      root: this.root,
      page,
      file,
      recognizeWholePage: () => this.delegate.recognizePage(file, index)
    });
  }
}
