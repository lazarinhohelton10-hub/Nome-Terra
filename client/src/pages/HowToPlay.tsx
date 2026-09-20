import { Link } from 'react-router-dom';

const STEPS = [
  'Cria ou entra numa sala.',
  'Convida os teus amigos com o código ou o link.',
  'O jogo escolhe uma letra para todos, ao mesmo tempo.',
  'Preenche todas as categorias com essa letra antes do tempo acabar.',
  'Carrega em STOP para terminar a ronda mais cedo.',
  'Vota se as respostas dos outros jogadores são válidas.',
  'Recebe os pontos: 10 por resposta única, 5 se alguém repetiu a tua resposta.',
  'Ganha quem tiver mais pontos no final de todas as rondas.',
];

export default function HowToPlay() {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <Link to="/" className="text-sm text-paper/60 hover:text-paper">
        ← Voltar
      </Link>
      <h1 className="mt-6 font-display text-4xl font-semibold text-paper">Como jogar</h1>
      <ol className="mt-8 flex flex-col gap-4">
        {STEPS.map((step, i) => (
          <li key={i} className="flex gap-4 rounded-lg border border-paper/10 bg-ink-light p-4">
            <span className="font-display text-xl font-semibold text-gold">{i + 1}</span>
            <span className="text-paper/90">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
