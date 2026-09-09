import FootballMatchDetail from '@/components/football/FootballMatchDetail';
export default async function MatchPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{vista?:string;equipo?:string}>}) {
 const query=await searchParams;
 return <FootballMatchDetail id={(await params).id} initialLineup={query.vista==='alineaciones'} initialSide={query.equipo==='away'?'away':'home'}/>;
}
