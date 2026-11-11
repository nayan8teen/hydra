import fs from "node:fs";
import path from "node:path";

import { uploadGoogleDriveMedia } from "../google-drive/google-drive-media";

/**
 * Fork: souvenir images are stored as content-addressed blobs in the user's
 * own Google Drive, so there is no presign/authorization round trip anymore.
 */
export class AchievementImageService {
  public static async uploadAchievementImage(imagePath: string) {
    const image = await fs.promises.readFile(imagePath);
    const imageExt = path.extname(imagePath).slice(1).toLowerCase() || "jpg";

    return uploadGoogleDriveMedia({ data: image, extension: imageExt });
  }
}
