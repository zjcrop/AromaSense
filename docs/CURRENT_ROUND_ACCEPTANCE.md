# AromaSense current-round visible acceptance gate

This gate exists because implementation presence is not sufficient product acceptance.

The current formal Web flow must visibly satisfy all of the following before the round is reported complete:

1. Manual sample intake explicitly states one sample per line and accepts multi-sample text.
2. The formal cupping strip contains exactly seven steps: 香气 / 高温 / 中温 / 低温 / 风味 / 综评 / 评分.
3. Stage identity itself has no dedicated color. Progress is the only color semantic:
   - gray: 未开始;
   - light blue: 已开始;
   - green: 已完成.
4. Merely browsing/selecting a step does not change it from 未开始.
5. Saving meaningful sensory input changes the step to 已开始 unless its completion contract is already satisfied.
6. Satisfying the completion contract changes the step to 已完成.
7. The currently selected step visibly exposes its completion criterion; hover-only help is not sufficient.
8. Expanded left rail shows the three-color legend below the session 完成 action.
9. 综评 visibly contains quality assessment plus 缺陷与异味; 评分 requires explicit confirmation.
10. Hard refresh preserves the in-progress session and saved observation.

Legacy `preparation`, `final`, stage-specific tones and `near_complete` may remain readable for old records, but they must not create additional visual states in the formal `sensory-flow/2.0` UI.
