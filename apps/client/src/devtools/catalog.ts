import type {
  ActionAvailability,
  ActionDescription,
  ActionGroup,
} from '../model/actions';

type CatalogFilters = {
  group: ActionGroup;
};

/** One group's actions in catalog order, available ones first. */
export function browseActions<
  T extends ActionDescription & { availability: ActionAvailability },
>(actions: T[], filters: CatalogFilters): T[] {
  return actions
    .filter((action) => action.group === filters.group)
    .sort((a, b) => Number(b.availability.available) - Number(a.availability.available));
}
