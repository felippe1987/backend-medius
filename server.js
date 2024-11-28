require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// Configuração do MySQL com Pool de Conexões
const db = mysql.createPool({
  host: process.env.DB_HOST  ,
  user: process.env.DB_USER  ,
  port: process.env.DB_PORT  ,
  password: process.env.DB_PASSWORD ,
  database: process.env.DB_NAME ,
});

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Servir arquivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rota de Registro para Juízes e Funcionários Públicos
app.post('/register', async (req, res) => {
  const { nome, email, cpf, senha, role, cargo, departamento } = req.body;

  if (!nome || !email || !cpf || !senha || !role) {
    return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
  }

  try {
    let query, values;

    if (role === 'juiz') {
      query = 'INSERT INTO juizes (nome, email, cpf, senha, role_id) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nome_role = ?))';
      values = [nome, email, cpf, await bcrypt.hash(senha, 10), 'juiz'];
    } else if (role === 'funcionario_publico') {
      query = 'INSERT INTO funcionarios_publicos (nome, email, cpf, senha, cargo, departamento, role_id) VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM roles WHERE nome_role = ?))';
      values = [nome, email, cpf, await bcrypt.hash(senha, 10), cargo, departamento, 'funcionario_publico'];
    } else {
      return res.status(400).json({ error: 'Role inválido.' });
    }

    const [result] = await db.query(query, values);

    if (!result.insertId) {
      throw new Error('Erro ao inserir usuário no banco de dados.');
    }

    res.status(201).json({ message: 'Usuário cadastrado com sucesso!', userId: result.insertId });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: `Erro no servidor durante o registro: ${error.message}` });
  }
});

// Rota de Login
app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  try {
    const [user] = await db.query(
      `SELECT id, nome, email, senha, role_id 
       FROM juizes WHERE email = ? 
       UNION 
       SELECT id, nome, email, senha, role_id 
       FROM funcionarios_publicos WHERE email = ?`,
      [email, email]
    );

    if (user.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const usuario = user[0];
    const isMatch = await bcrypt.compare(senha, usuario.senha);

    if (!isMatch) {
      return res.status(400).json({ error: 'Senha incorreta' });
    }

    const redirectUrl = usuario.role_id === 1 ? '/home-juiz' : '/home-funcionario';

    res.status(200).json({
      message: 'Login realizado com sucesso',
      userId: usuario.id,
      redirectUrl,
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor durante o login' });
  }
});

// Rota para upload de arquivos
app.post('/api/casos/pastas/:id/arquivos', upload.single('arquivo'), async (req, res) => {
  const { id } = req.params;
  const { filename } = req.file;

  try {
    await db.query('INSERT INTO arquivos (id_pasta, nome) VALUES (?, ?)', [id, filename]);
    res.status(201).json({ message: 'Arquivo enviado com sucesso!', filename });
  } catch (error) {
    console.error('Erro ao salvar arquivo no banco:', error);
    res.status(500).json({ error: 'Erro ao salvar arquivo' });
  }
});

// Rota para listar pastas com seus arquivos
app.get('/api/casos/pastas-com-arquivos', async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT 
        p.id AS pasta_id, 
        p.nome AS pasta_nome, 
        a.id AS arquivo_id, 
        a.nome AS arquivo_nome
      FROM pastas p
      LEFT JOIN arquivos a ON p.id = a.id_pasta
      ORDER BY p.id, a.id
    `);

    const pastasComArquivos = [];
    const pastasMap = {};

    result.forEach((row) => {
      if (!pastasMap[row.pasta_id]) {
        pastasMap[row.pasta_id] = {
          id: row.pasta_id,
          nome: row.pasta_nome,
          arquivos: [],
        };
        pastasComArquivos.push(pastasMap[row.pasta_id]);
      }
      if (row.arquivo_id) {
        pastasMap[row.pasta_id].arquivos.push({
          id: row.arquivo_id,
          nome: row.arquivo_nome,
          caminho: `http://localhost:5000/uploads/${row.arquivo_nome}`,
        });
      }
    });

    res.status(200).json(pastasComArquivos);
  } catch (error) {
    console.error('Erro ao listar pastas e arquivos:', error);
    res.status(500).json({ error: 'Erro ao listar pastas e arquivos' });
  }
});

app.post('/api/casos/pastas/criar', async (req, res) => {
  const { nome } = req.body;

  if (!nome || nome.trim() === '') {
    return res.status(400).json({ error: 'O nome da pasta é obrigatório.' });
  }

  try {
    const [result] = await db.query('INSERT INTO pastas (nome) VALUES (?)', [nome]);

    if (result.insertId) {
      res.status(201).json({ id: result.insertId, nome });
    } else {
      throw new Error('Erro ao criar pasta no banco de dados.');
    }
  } catch (error) {
    console.error('Erro ao criar pasta:', error);
    res.status(500).json({ error: 'Erro no servidor ao criar pasta.' });
  }
});


  // Rota para excluir uma pasta e seus arquivos associados
app.delete('/api/casos/pastas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar todos os arquivos da pasta
    const [arquivos] = await db.query('SELECT nome FROM arquivos WHERE id_pasta = ?', [id]);

    // Excluir arquivos do sistema de arquivos
    arquivos.forEach((arquivo) => {
      fs.unlinkSync(path.join(__dirname, 'uploads', arquivo.nome));
    });

    // Excluir os arquivos do banco de dados
    await db.query('DELETE FROM arquivos WHERE id_pasta = ?', [id]);

    // Excluir a pasta do banco de dados
    await db.query('DELETE FROM pastas WHERE id = ?', [id]);

    res.status(200).json({ message: 'Pasta e arquivos associados excluídos com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir pasta:', error);
    res.status(500).json({ error: 'Erro ao excluir pasta' });
  }
});

// Rota para buscar todas as notas de uma pasta
app.get('/api/casos/pastas/:id/notas', async (req, res) => {
  const { id } = req.params;

  try {
    const [notas] = await db.query('SELECT id, texto FROM notas WHERE id_pasta = ?', [id]);
    res.status(200).json(notas);
  } catch (error) {
    console.error('Erro ao buscar notas:', error);
    res.status(500).json({ error: 'Erro ao buscar notas' });
  }
});
app.get('/juizes', async (req, res) => {
  let connection;
  try {
    connection = await db.promise().getConnection();
    const [result] = await connection.query('SELECT * FROM juizes');
    res.send(result);
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).send({ error: 'Erro ao buscar usuários' });
  } finally {
    if (connection) connection.release();
  }
});
// Rota para excluir uma nota
app.delete('/api/casos/notas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM notas WHERE id = ?', [id]);
    res.status(200).json({ message: 'Nota excluída com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir nota:', error);
    res.status(500).json({ error: 'Erro ao excluir nota' });
  }
});

// Rota para buscar detalhes completos de uma pasta
app.get('/api/casos/pastas/:id/detalhes', async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar informações da pasta
    const [[pasta]] = await db.query('SELECT id, nome FROM pastas WHERE id = ?', [id]);

    if (!pasta) {
      return res.status(404).json({ error: 'Pasta não encontrada.' });
    }

    // Buscar arquivos da pasta
    const [arquivos] = await db.query('SELECT id, nome FROM arquivos WHERE id_pasta = ?', [id]);

    // Buscar notas da pasta
    const [notas] = await db.query('SELECT id, texto FROM notas WHERE id_pasta = ?', [id]);

    res.status(200).json({
      ...pasta,
      arquivos: arquivos.map((arquivo) => ({
        ...arquivo,
        caminho: `http://localhost:5000/uploads/${arquivo.nome}`,
      })),
      notas,
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes da pasta:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da pasta.' });
  }
});


// Rota para pesquisa de documentos
app.get('/api/casos/arquivos/pesquisa', async (req, res) => {
  const { query, pasta } = req.query;

  try {
    let sql = `
      SELECT 
        a.id, 
        a.nome, 
        p.nome AS pasta_nome 
      FROM arquivos a 
      INNER JOIN pastas p ON a.id_pasta = p.id
      WHERE a.nome LIKE ? 
    `;
    const params = [`%${query}%`];

    if (pasta) {
      sql += ' AND p.nome LIKE ?';
      params.push(`%${pasta}%`);
    }

    const [result] = await db.query(sql, params);

    res.status(200).json(result.map((arquivo) => ({
      id: arquivo.id,
      nome: arquivo.nome,
      pasta: arquivo.pasta_nome,
      caminho: `http://localhost:5000/uploads/${arquivo.nome}`,
    })));
  } catch (error) {
    console.error('Erro na pesquisa de documentos:', error);
    res.status(500).json({ error: 'Erro ao pesquisar documentos.' });
  }
});


// Rota para buscar jurisprudências
app.get('/api/jurisprudencias', async (req, res) => {
  const { termo } = req.query;

  try {
    const [jurisprudencias] = await db.query(
      'SELECT id, titulo, descricao, data FROM jurisprudencias WHERE titulo LIKE ? OR descricao LIKE ?',
      [`%${termo}%`, `%${termo}%`]
    );

    res.status(200).json(jurisprudencias);
  } catch (error) {
    console.error('Erro ao buscar jurisprudências:', error);
    res.status(500).json({ error: 'Erro ao buscar jurisprudências.' });
  }
});


// Finalização
// Porta do servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

