import type { AskType } from '@/lib/asks';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BuildRoundedIcon from '@mui/icons-material/BuildRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';

const icons = {
	time: AccessTimeRoundedIcon,
	task: BuildRoundedIcon,
	item: Inventory2RoundedIcon,
	money: PaymentsRoundedIcon,
	resource: AutoAwesomeRoundedIcon,
};

export function AskTypeGlyph({ type }: { type: AskType }) {
	const Icon = icons[type];
	return (
		<span
			className={`ask-type-glyph ask-type-glyph--${type}`}
			aria-hidden='true'>
			<Icon fontSize='inherit' />
		</span>
	);
}
