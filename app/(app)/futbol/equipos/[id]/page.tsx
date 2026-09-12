import FootballTeamProfile from '@/components/football/FootballTeamProfile';
export default async function TeamPage({params}:{params:Promise<{id:string}>}) {
 return <FootballTeamProfile id={(await params).id}/>;
}
