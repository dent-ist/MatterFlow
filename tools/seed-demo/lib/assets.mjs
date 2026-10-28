// Which assets a task's form may refer to (a form accepts an Active asset only; the API says "Asset N does not exist or is not active" otherwise).

/** True for an asset a task form can still choose: no disposition yet, or Active. */
export function isChoosable(asset) {
  return !asset.dispositionCode || asset.dispositionCode === 'ACTIVE';
}

/** The pool entries ({ assetId, assetTypeId }) of the assets a task form can choose, from a matter's asset list. */
export function choosablePool(assets) {
  return assets.filter(isChoosable).map((a) => ({ assetId: a.assetId, assetTypeId: a.assetTypeId }));
}
