import type {
  ActionAvailability,
  ActionDescription,
  ActionGroup,
} from '../model/actions';

type CatalogFilters = {
  group: ActionGroup | 'Suggested';
};

/** Suggestions rank available next steps; other groups retain catalog order. */
export function browseActions<
  T extends ActionDescription & {
    availability: ActionAvailability;
    suggested: number | null;
  },
>(actions: T[], filters: CatalogFilters): T[] {
  return actions
    .filter((action) =>
      filters.group === 'Suggested'
        ? action.availability.available && action.suggested !== null
        : action.group === filters.group,
    )
    .sort((a, b) =>
      filters.group === 'Suggested'
        ? (a.suggested ?? Infinity) - (b.suggested ?? Infinity)
        : Number(b.availability.available) - Number(a.availability.available),
    );
}
