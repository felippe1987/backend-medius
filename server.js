require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

// Configuração do MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'sjd-bd',
});

// Conexão com o banco de dados
db.connect(err => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err);
  } else {
    console.log('Conectado ao MySQL');
  }
});

app.post('/register', async (req, res) => {
  const { email, cpf, telefone, nome_completo, senha, role } = req.body;

  // Adicionando logs para verificar os dados recebidos
  console.log("Dados recebidos no registro:", { email, cpf, telefone, nome_completo, senha, role });

  // Verificação de campos obrigatórios
  if (!email || !cpf || !telefone || !nome_completo || !senha || !role) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  try {
    // Verifica se o e-mail já está registrado
    db.query('SELECT * FROM usuarios WHERE email = ?', [email], async (err, results) => {
      if (err) {
        console.error('Erro ao buscar usuário:', err);
        return res.status(500).json({ error: 'Erro no servidor' });
      }

      if (results.length > 0) {
        return res.status(400).json({ error: 'Usuário já existe' });
      }

      // Cria o hash da senha
      const hashedPassword = await bcrypt.hash(senha, 10);

      // Insere o novo usuário no banco de dados
      db.query(
        'INSERT INTO usuarios (email, cpf, telefone, nome_completo, senha, role) VALUES (?, ?, ?, ?, ?, ?)',
        [email, cpf, telefone, nome_completo, hashedPassword, role],
        (err, result) => {
          if (err) {
            console.error('Erro ao inserir no banco de dados:', err);
            return res.status(500).json({ error: 'Erro ao inserir no banco de dados' });
          }

          let redirectUrl = '';
          if (role === 'juiz') redirectUrl = '/home-juiz';
          else if (role === 'cidadao') redirectUrl = '/home-cidadao';
          else if (role === 'empresa_juridica') redirectUrl = '/home-advogado';

          return res.status(201).json({ message: 'Usuário cadastrado com sucesso!', redirectUrl, userId: result.insertId });
        }
      );
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro no servidor durante o registro' });
  }
});

// Rota de Login de Usuário
app.post('/login', (req, res) => {
  const { email, senha } = req.body;

  // Busca o usuário no banco de dados
  db.query('SELECT * FROM usuarios WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.error('Erro ao buscar usuário:', err);
      return res.status(500).json({ error: 'Erro no servidor' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(senha, user.senha);
    if (!isMatch) return res.status(400).json({ error: 'Senha incorreta' });

    let redirectUrl = '';
    if (user.role === 'juiz') redirectUrl = '/home-juiz';
    else if (user.role === 'cidadao') redirectUrl = '/home-cidadao';
    else if (user.role === 'empresa_juridica') redirectUrl = '/home-advogado';

    res.status(200).json({
      message: 'Login realizado com sucesso',
      userId: user.id,
      redirectUrl,
    });
  });
});

// Rota para obter detalhes da conta do usuário
app.get('/api/usuario/:id', (req, res) => {
  const userId = req.params.id;

  db.query('SELECT email, cpf, telefone, nome_completo, senha FROM usuarios WHERE id = ?', [userId], (err, results) => {
    if (err) {
      console.error('Erro ao buscar dados do usuário:', err);
      return res.status(500).json({ error: 'Erro ao buscar dados do usuário.' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = results[0];
    res.status(200).json({
      email: user.email,
      cpf: user.cpf,
      telefone: user.telefone,
      nome_completo: user.nome_completo,
      senha: user.senha // Adiciona a senha na resposta (apenas para esta configuração temporária)
    });
  });
});

// Porta do servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
