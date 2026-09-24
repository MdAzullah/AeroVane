import { createEffect, onCleanup } from 'solid-js';
import { appState, applyFaultEvent, beginFaultAnalysis, completeFaultAnalysis, resetFaultState } from '../store';
import { useWorkerBridge } from '../services';

/** Keeps worker-owned analysis events synchronized with main-thread UI state. */
export function useFaultEvents(): void {
  const workerBridge = useWorkerBridge();

  createEffect(() => {
    if (!appState.isReady) return;
    const unsubscribeEvent = workerBridge.onFaultEvent(applyFaultEvent);
    const unsubscribeReset = workerBridge.onFaultReset(resetFaultState);
    const unsubscribeAnalysisStarted = workerBridge.onFaultAnalysisStarted(beginFaultAnalysis);
    const unsubscribeAnalysisComplete = workerBridge.onFaultAnalysisComplete(completeFaultAnalysis);
    onCleanup(() => {
      unsubscribeEvent();
      unsubscribeReset();
      unsubscribeAnalysisStarted();
      unsubscribeAnalysisComplete();
    });
  });
}
