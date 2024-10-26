// Server.js
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

// Configuração do MySQL
const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: 'root',
  database: 'sjd-bd'
});

db.connect(err => {
  if (err) {
    console.log('Erro ao conectar ao banco de dados:', err);
  } else {
    console.log('Conectado ao MySQL');
  }
});

// No registro de usuário
app.post('/register', async (req, res) => {
  const { email, cpf, telefone, nome_completo, senha, role } = req.body;

  db.query('SELECT * FROM usuarios WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Erro no servidor' });

    if (results.length > 0) {
      return res.status(400).json({ error: 'Usuário já existe' });
    }

    const hashedPassword = await bcrypt.hash(senha, 10);

    db.query(
      'INSERT INTO usuarios (email, cpf, telefone, nome_completo, senha, role) VALUES (?, ?, ?, ?, ?, ?)',
      [email, cpf, telefone, nome_completo, hashedPassword, role],
      (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao inserir no banco de dados' });

        // Corrigindo URLs de redirecionamento para coincidir com o front-end
        let redirectUrl = '';
        if (role === 'juiz') redirectUrl = '/home-juiz';
        else if (role === 'cidadao') redirectUrl = '/home-cidadao';
        else if (role === 'empresa_juridica') redirectUrl = '/home-advogado';

        return res.status(201).json({ message: 'Usuário cadastrado com sucesso!', redirectUrl });
      }
    );
  });
});

// No login
app.post('/login', (req, res) => {
  const { email, senha } = req.body;

  db.query('SELECT * FROM usuarios WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Erro no servidor' });

    if (results.length === 0) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(senha, user.senha);
    if (!isMatch) return res.status(400).json({ error: 'Senha incorreta' });

    const token = jwt.sign({ id: user.id, role: user.role }, 'seu_segredo', { expiresIn: '1h' });

    // Corrigindo URLs de redirecionamento para coincidir com o front-end
    let redirectUrl = '';
    if (user.role === 'juiz') redirectUrl = '/home-juiz';
    else if (user.role === 'cidadao') redirectUrl = '/home-cidadao';
    else if (user.role === 'empresa_juridica') redirectUrl = '/home-advogado';

    res.status(200).json({
      message: 'Login realizado com sucesso',
      token,
      redirectUrl,
    });
  });
});

// Middleware para autenticar JWT
const autenticarJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(403).json({ error: 'Acesso negado, faça login novamente.' });

  jwt.verify(token, 'seu_segredo', (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado.' });
    req.user = user;  // Adiciona os dados do usuário no request
    next();
  });
};

// Rota para obter detalhes da conta do usuário
app.get('/api/usuario', autenticarJWT, (req, res) => {
  const userId = req.user.id;

  db.query('SELECT email, cpf, telefone, nome_completo FROM usuarios WHERE id = ?', [userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar dados do usuário.' });

    if (results.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const user = results[0];
    res.status(200).json({
      email: user.email,
      cpf: user.cpf,
      telefone: user.telefone,
      nome_completo: user.nome_completo,
    });
  });
});

// Rota para alterar senha do usuário
app.post('/api/usuario/alterar-senha', autenticarJWT, async (req, res) => {
  const userId = req.user.id;
  const { senhaAntiga, novaSenha } = req.body;

  // Primeiro, verificar se a senha antiga está correta
  db.query('SELECT senha FROM usuarios WHERE id = ?', [userId], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Erro no servidor ao buscar senha.' });

    if (results.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const senhaHash = results[0].senha;

    const isMatch = await bcrypt.compare(senhaAntiga, senhaHash);
    if (!isMatch) return res.status(400).json({ error: 'Senha antiga incorreta.' });

    // Se a senha antiga estiver correta, atualizar com a nova senha
    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
    db.query('UPDATE usuarios SET senha = ? WHERE id = ?', [novaSenhaHash, userId], (err) => {
      if (err) return res.status(500).json({ error: 'Erro ao atualizar a senha.' });
      res.status(200).json({ message: 'Senha alterada com sucesso.' });
    });
  });
});



app.listen(5000, () => {
  console.log('Servidor rodando na porta 5000');
});
