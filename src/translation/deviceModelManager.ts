import {
  isOnnxDownloadSupported,
  onnxCancelDownload,
  onnxCheckModel,
  onnxDeleteModelFile,
  onnxDownloadModel,
  onnxGetActiveModel,
  onnxGetDownloadProgress,
  onnxListModelFiles,
  onnxSetActiveModel,
  type InstalledModelFile,
  type OnnxDownloadProgress,
} from 'screen-translator-overlay';

import { getDeviceModelPack, type DeviceModelPack } from './modelCatalog';
import type { DeviceTranslationModel } from './types';

export type DeviceModelState = 'unavailable' | 'not-installed' | 'installing' | 'installed' | 'active';

export interface DeviceModelStatus {
  pack: DeviceModelPack;
  state: DeviceModelState;
  files: InstalledModelFile[];
  progress?: OnnxDownloadProgress;
  error?: string;
}

export class DeviceModelManager {
  getDownloadProgress(): OnnxDownloadProgress {
    return onnxGetDownloadProgress();
  }

  async getStatus(id: DeviceTranslationModel): Promise<DeviceModelStatus> {
    const pack = getDeviceModelPack(id);
    if (!isOnnxDownloadSupported()) {
      return { pack, state: 'unavailable', files: [] };
    }
    const files = onnxListModelFiles();
    const active = onnxGetActiveModel();
    const installed = files.some((file) => file.name === pack.activeModelFileName);
    const progress = onnxGetDownloadProgress();
    const installing =
      (progress.status === 'downloading' || progress.status === 'extracting') &&
      (progress.targetFileName === pack.archiveFileName ||
        progress.targetFileName.includes(pack.filePrefix) ||
        pack.archiveFileName.includes(progress.targetFileName));
    return {
      pack,
      files,
      progress: installing ? progress : undefined,
      state: active === pack.activeModelFileName
        ? 'active'
        : installing
          ? 'installing'
          : installed
            ? 'installed'
            : 'not-installed',
      error: progress.status === 'error' && (progress.targetFileName === pack.archiveFileName || progress.targetFileName.includes(pack.filePrefix))
        ? progress.error
        : undefined,
    };
  }

  async install(id: DeviceTranslationModel): Promise<boolean> {
    const pack = getDeviceModelPack(id);
    if (!pack.downloadUrl) {
      throw new Error(`模型 ${pack.displayName} 尚未配置下载地址`);
    }
    if (!pack.sha256) {
      throw new Error(`模型 ${pack.displayName} 尚未配置 SHA-256，拒绝不安全下载`);
    }
    console.log(`[DeviceModelManager] 开始下载模型: ${pack.displayName}`);
    console.log(`  URL: ${pack.downloadUrl}`);
    console.log(`  Target: ${pack.archiveFileName}`);
    console.log(`  Expected SHA-256: ${pack.sha256}`);

    try {
      const installed = await onnxDownloadModel(
        pack.downloadUrl,
        pack.archiveFileName,
        pack.sha256,
        pack.activeModelFileName
      );
      if (!installed) {
        const progress = onnxGetDownloadProgress();
        const errorDetail = progress.error ? ` (${progress.error})` : '';
        throw new Error(`下载中断或失败${errorDetail}`);
      }
      return this.activate(id);
    } catch (err: any) {
      console.error(`[DeviceModelManager] 模型下载发生异常:`, err);
      throw err;
    }
  }

  cancelInstall(): void {
    onnxCancelDownload();
  }

  async activate(id: DeviceTranslationModel): Promise<boolean> {
    const pack = getDeviceModelPack(id);
    const status = await this.getStatus(id);
    if (status.state === 'active') return true;
    if (status.state !== 'installed') {
      throw new Error(`模型 ${pack.displayName} 尚未安装`);
    }
    return onnxSetActiveModel(pack.activeModelFileName);
  }

  async remove(id: DeviceTranslationModel): Promise<boolean> {
    const pack = getDeviceModelPack(id);
    const matchingFiles = onnxListModelFiles().filter((file) =>
      file.name.startsWith(pack.filePrefix)
    );
    const results = await Promise.all(
      matchingFiles.map((file) => onnxDeleteModelFile(file.name))
    );
    return results.every(Boolean);
  }

  async checkRuntime(): Promise<Awaited<ReturnType<typeof onnxCheckModel>>> {
    return onnxCheckModel();
  }
}

